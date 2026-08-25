import { test, expect } from "@playwright/test";
import { uploadFile, deleteObject, minimalPdf, BUCKET } from "./helpers";

test.describe("File preview", () => {
	const testFiles = {
		"e2e-preview.txt": { content: "Hello from E2E test!", type: "text/plain" },
		"e2e-preview.json": {
			content: JSON.stringify({ name: "test", value: 42 }, null, 2),
			type: "application/json",
		},
		"e2e-preview.csv": {
			content: "name,age,city\nAlice,30,NYC\nBob,25,LA",
			type: "text/csv",
		},
		"e2e-preview.md": {
			content: "# Hello Markdown\n\nThis is a **test**.",
			type: "text/markdown",
		},
		"e2e-preview.html": {
			content: "<h1>Test HTML</h1><p>Hello world</p>",
			type: "text/html",
		},
		"e2e-preview.pdf": { content: minimalPdf(), type: "application/pdf" },
	};

	test.beforeAll(async ({ request }) => {
		for (const [key, file] of Object.entries(testFiles)) {
			await uploadFile(request, key, file.content, file.type);
		}
	});

	test.afterAll(async ({ request }) => {
		for (const key of Object.keys(testFiles)) {
			await deleteObject(request, key);
		}
	});

	test("previews a text file", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.txt")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.txt").dblclick();

		await expect(page.locator("text=Hello from E2E test!")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("previews a JSON file", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.json")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.json").dblclick();

		await expect(page.locator("text=test")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("previews a CSV file as a table", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.csv")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.csv").dblclick();

		// CSV should render as an HTML table with headers and data
		await expect(page.locator(".q-dialog th:has-text('name')")).toBeVisible({
			timeout: 10_000,
		});
		await expect(page.locator(".q-dialog td:has-text('Alice')")).toBeVisible();
		await expect(page.locator(".q-dialog td:has-text('Bob')")).toBeVisible();
	});

	test("previews a markdown file", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.md")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.md").dblclick();

		await expect(page.locator("text=Hello Markdown")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("previews an HTML file", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.html")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.html").dblclick();

		// HTML content is rendered via v-html in a <pre> tag
		await expect(page.locator(".q-dialog").locator("text=Test HTML")).toBeVisible({
			timeout: 10_000,
		});
		await expect(
			page.locator(".q-dialog").locator("text=Hello world"),
		).toBeVisible();
	});

	test("renders a PDF preview", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.pdf")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.pdf").dblclick();

		// Rendering is the only thing `isEvalSupported: false` in PdfVuer.vue
		// could plausibly break, and nothing covered PDFs before. A canvas
		// exists only once pdf.js has resolved the document (numPages drives
		// the v-for) and rasterised a page, so this covers load and render end
		// to end rather than just the dialog opening.
		const canvas = page.locator("#pdfvuer canvas").first();
		await expect(canvas).toBeVisible({ timeout: 20_000 });

		// A blank canvas would satisfy the check above, so require real ink.
		await expect
			.poll(
				() =>
					canvas.evaluate((el: HTMLCanvasElement) => {
						const ctx = el.getContext("2d");
						if (!ctx || !el.width || !el.height) return 0;
						const { data } = ctx.getImageData(0, 0, el.width, el.height);
						let marked = 0;
						for (let i = 0; i < data.length; i += 4) {
							if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) {
								marked++;
							}
						}
						return marked;
					}),
				{ timeout: 20_000 },
			)
			.toBeGreaterThan(0);
	});

	test("shows filename in preview header", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-preview.txt")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-preview.txt").dblclick();

		await expect(
			page.locator(".q-dialog").locator("text=e2e-preview.txt"),
		).toBeVisible({
			timeout: 10_000,
		});
	});
});

test.describe("File editing", () => {
	test.beforeEach(async ({ request }) => {
		await uploadFile(request, "e2e-editable.txt", "original content");
	});

	test.afterEach(async ({ request }) => {
		await deleteObject(request, "e2e-editable.txt");
	});

	test("edits and saves a text file", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-editable.txt")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-editable.txt").dblclick();

		// Wait for preview to load with original content
		await expect(page.locator("text=original content")).toBeVisible({
			timeout: 10_000,
		});

		// Click edit button (lowercase label "edit")
		await page.locator(".q-dialog").getByRole("button", { name: "edit" }).click();

		// Textarea should appear — fill with new content
		const textarea = page.locator(".q-dialog textarea");
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("updated content");

		// Save
		await page.locator(".q-dialog").getByRole("button", { name: "Save" }).click();

		// After save, preview should reload with updated content
		await expect(page.locator("text=updated content")).toBeVisible({
			timeout: 10_000,
		});
	});

	test("cancels edit without saving", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-editable.txt")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-editable.txt").dblclick();
		await expect(page.locator("text=original content")).toBeVisible({
			timeout: 10_000,
		});

		// Enter edit mode
		await page.locator(".q-dialog").getByRole("button", { name: "edit" }).click();
		const textarea = page.locator(".q-dialog textarea");
		await expect(textarea).toBeVisible({ timeout: 5_000 });
		await textarea.fill("should not be saved");

		// Cancel edit
		await page.locator(".q-dialog").getByRole("button", { name: "Cancel" }).click();

		// Original content should still be displayed (not the unsaved edit)
		await expect(page.locator("text=original content")).toBeVisible({
			timeout: 5_000,
		});
	});
});
