import { describe, expect, it } from "vitest";
import {
	DEVTEST_API_SERVER,
	isDevtestHost,
	resolveServerUrl,
} from "src/apiBase";

describe("isDevtestHost", () => {
	it("matches GitHub Pages hosts", () => {
		expect(isDevtestHost("rainiersvn.github.io")).toBe(true);
	});

	it("does not match production hosts", () => {
		expect(isDevtestHost("explorer.cloudkid.link")).toBe(false);
	});

	it("does not match localhost", () => {
		expect(isDevtestHost("localhost")).toBe(false);
	});
});

describe("resolveServerUrl", () => {
	it("uses VUE_APP_SERVER_URL in development", () => {
		const url = resolveServerUrl({
			hostname: "localhost",
			origin: "http://localhost:9000",
			env: { NODE_ENV: "development", VUE_APP_SERVER_URL: "http://api.local" },
		});
		expect(url).toBe("http://api.local");
	});

	it("falls back to localhost:8787 in development", () => {
		const url = resolveServerUrl({
			hostname: "localhost",
			origin: "http://localhost:9000",
			env: { NODE_ENV: "development" },
		});
		expect(url).toBe("http://localhost:8787");
	});

	it("uses the devtest API server on GitHub Pages", () => {
		const url = resolveServerUrl({
			hostname: "rainiersvn.github.io",
			origin: "https://rainiersvn.github.io",
			env: { NODE_ENV: "production" },
		});
		expect(url).toBe(DEVTEST_API_SERVER);
	});

	it("uses the page origin in production", () => {
		const url = resolveServerUrl({
			hostname: "explorer.cloudkid.link",
			origin: "https://explorer.cloudkid.link",
			env: { NODE_ENV: "production" },
		});
		expect(url).toBe("https://explorer.cloudkid.link");
	});
});
