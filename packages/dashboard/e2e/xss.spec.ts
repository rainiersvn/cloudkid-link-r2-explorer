import { test, expect, type Page } from "@playwright/test";
import {
	uploadFile,
	deleteObject,
	seedEmail,
	cleanupPrefix,
	BUCKET,
} from "./helpers";

/**
 * Bucket contents are untrusted. The worker's email handler writes inbound mail
 * and every attachment to R2 with no authentication, and uploads are open
 * whenever the instance is not in readonly mode, so anyone who can reach the
 * mailbox can choose what a previewed file contains.
 *
 * The payload sets a flag from an image error handler rather than calling
 * alert(), because Playwright auto-dismisses dialogs and the test would pass
 * either way. A flag on window is unambiguous: it is only ever set if the
 * markup was parsed as HTML and the handler ran.
 */
const PAYLOAD = '<img src=x onerror="window.__xssFired = true">';

/** Read the flag back, treating "never defined" and false alike. */
async function xssFired(page: Page): Promise<boolean> {
	return page.evaluate(() => Boolean((window as any).__xssFired));
}

/** Give an injected handler a chance to run before asserting it did not. */
async function settle(page: Page) {
	await page.waitForTimeout(500);
}

const EML = [
	"From: Mallory <mallory@example.com>",
	"To: test@example.com",
	"Subject: eml payload",
	"Content-Type: text/plain; charset=utf-8",
	"",
	PAYLOAD,
	"",
].join("\r\n");

test.describe("Preview XSS", () => {
	const files: Record<string, string> = {
		"e2e-xss.txt": PAYLOAD,
		"e2e-xss.md": `# Heading\n\n${PAYLOAD}\n`,
		"e2e-xss.csv": `name,note\nAlice,${PAYLOAD}`,
		"e2e-xss.json": JSON.stringify({ note: PAYLOAD }),
		"e2e-xss.html": `<p>hello</p>${PAYLOAD}`,
		"e2e-xss.unknownext": PAYLOAD,
		"e2e-xss.eml": EML,
	};

	test.beforeAll(async ({ request }) => {
		for (const [key, content] of Object.entries(files)) {
			await uploadFile(request, key, content);
		}
	});

	test.afterAll(async ({ request }) => {
		for (const key of Object.keys(files)) {
			await deleteObject(request, key);
		}
	});

	// Each of these previews reached v-html before this was fixed.
	for (const name of [
		"e2e-xss.txt",
		"e2e-xss.md",
		"e2e-xss.csv",
		"e2e-xss.json",
		"e2e-xss.unknownext",
		"e2e-xss.eml",
	]) {
		test(`does not execute markup in ${name}`, async ({ page }) => {
			await page.goto(`/${BUCKET}/files`);
			await expect(page.locator(`text=${name}`)).toBeVisible({
				timeout: 15_000,
			});

			await page.locator(`text=${name}`).dblclick();
			await expect(page.locator(".q-dialog")).toBeVisible({ timeout: 10_000 });
			await settle(page);

			expect(await xssFired(page)).toBe(false);

			// The payload should still be readable -- escaped, not silently dropped,
			// or this would pass just as well against a preview that renders nothing.
			await expect(page.locator(".q-dialog")).toContainText("onerror");
		});
	}

	test("renders an HTML file inside a sandboxed frame", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-xss.html")).toBeVisible({
			timeout: 15_000,
		});

		await page.locator("text=e2e-xss.html").dblclick();

		// HTML files are the one preview that still renders markup, so it has to
		// happen somewhere that cannot reach this origin. An empty sandbox
		// attribute withholds every capability, allow-scripts included.
		const frame = page.locator(".q-dialog iframe.preview-frame");
		await expect(frame).toBeVisible({ timeout: 10_000 });
		await expect(frame).toHaveAttribute("sandbox", "");

		await settle(page);
		expect(await xssFired(page)).toBe(false);
	});
});

test.describe("Email XSS", () => {
	test.afterEach(async ({ request }) => {
		await cleanupPrefix(request, ".r2-explorer/emails/");
	});

	test("does not execute markup in a plain-text body", async ({
		page,
		request,
	}) => {
		// No HTML part, so EmailFilePage takes its text branch -- which passed the
		// body straight to v-html before this was fixed. No encoding tricks needed.
		await seedEmail(request, "1000000000002-e2e-xss-text", {
			subject: "Payload in the text body",
			fromName: "Mallory",
			fromAddress: "mallory@example.com",
			body: PAYLOAD,
			html: "",
		});

		await page.goto(`/${BUCKET}/email`);
		await page
			.locator("td.email-subject", { hasText: "Payload in the text body" })
			.click({ timeout: 15_000 });

		await expect(page.locator("text=mallory@example.com")).toBeVisible({
			timeout: 10_000,
		});
		await settle(page);

		expect(await xssFired(page)).toBe(false);
		await expect(page.locator(".email-body")).toContainText("onerror");
	});

	test("renders an HTML body in a frame that cannot run script", async ({
		page,
		request,
	}) => {
		await seedEmail(request, "1000000000003-e2e-xss-html", {
			subject: "Payload in the html body",
			fromName: "Mallory",
			fromAddress: "mallory@example.com",
			body: "see html",
			html: `<p>hello</p>${PAYLOAD}`,
		});

		await page.goto(`/${BUCKET}/email`);
		await page
			.locator("td.email-subject", { hasText: "Payload in the html body" })
			.click({ timeout: 15_000 });

		const frame = page.locator("iframe#renderWindow");
		await expect(frame).toBeVisible({ timeout: 10_000 });

		// allow-scripts is the capability that matters here, and it must stay off:
		// this frame is granted allow-same-origin so the page can measure it.
		const sandbox = await frame.getAttribute("sandbox");
		expect(sandbox).not.toBeNull();
		expect(sandbox).not.toContain("allow-scripts");

		await settle(page);
		expect(await xssFired(page)).toBe(false);
	});
});
