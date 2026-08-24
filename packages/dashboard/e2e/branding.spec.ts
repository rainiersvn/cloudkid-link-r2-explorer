import { expect, test } from "@playwright/test";
import { BUCKET, deleteObject, uploadFile } from "./helpers";

test.describe("Branding", () => {
	test.beforeAll(async ({ request }) => {
		await uploadFile(
			request,
			"e2e-branding.txt",
			"branding test file",
			"text/plain",
		);
	});

	test.afterAll(async ({ request }) => {
		await deleteObject(request, "e2e-branding.txt");
	});

	test("topbar shows the Explorer logo", async ({ page }) => {
		await page.goto("/");

		const logo = page.locator('.q-toolbar img[src="/explorer-logo.svg"]');
		await expect(logo).toBeVisible({ timeout: 10_000 });
	});

	test("New button uses the purple/gold gradient CTA", async ({ page }) => {
		await page.goto(`/${BUCKET}/files`);

		const newButton = page.getByRole("button", { name: "New" });
		await expect(newButton).toBeVisible({ timeout: 10_000 });

		const background = await newButton.evaluate(
			(el) => getComputedStyle(el).backgroundImage,
		);
		expect(background).toContain("linear-gradient");
	});

	test("file preview header uses the brand surface instead of grey", async ({
		page,
	}) => {
		await page.goto(`/${BUCKET}/files`);
		await expect(page.locator("text=e2e-branding.txt")).toBeVisible({
			timeout: 10_000,
		});

		await page.locator("text=e2e-branding.txt").dblclick();

		const header = page.locator(".q-dialog .bg-brand-header");
		await expect(header).toBeVisible({ timeout: 10_000 });
		await expect(page.locator(".q-dialog .bg-grey-3")).toHaveCount(0);
	});
});
