import { describe, it, expect } from "vitest";
import { parseCsv } from "src/parsers/csv";
import { parseMarkdown } from "src/parsers/markdown";

// Both parsers hand their output to v-html, and both are fed file contents
// straight out of an R2 bucket. The worker's email handler writes inbound mail
// and attachments there without authentication, so "the file is hostile" is the
// default assumption, not an edge case.

describe("parseMarkdown", () => {
	it("still renders ordinary markdown", () => {
		const html = parseMarkdown("# Title\n\nSome **bold** text.\n");
		expect(html).toContain("<h1>Title</h1>");
		expect(html).toContain("<strong>bold</strong>");
	});

	it("renders links and images", () => {
		const html = parseMarkdown("[docs](https://example.com/docs)\n");
		expect(html).toContain('<a href="https://example.com/docs">docs</a>');

		const img = parseMarkdown("![alt](https://example.com/x.png)\n");
		expect(img).toContain('<img src="https://example.com/x.png" alt="alt" />');
	});

	it("escapes raw HTML in the source", () => {
		const html = parseMarkdown("<img src=x onerror=alert(1)>\n");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	it("escapes a script tag rather than emitting one", () => {
		const html = parseMarkdown("<script>alert(1)</script>\n");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("defuses javascript: links", () => {
		const html = parseMarkdown("[click](javascript:alert(1))\n");
		expect(html).not.toContain("javascript:");
		expect(html).toContain('href="#"');
	});

	it("defuses javascript: image sources", () => {
		const html = parseMarkdown("![x](javascript:alert(1))\n");
		expect(html).not.toContain("javascript:");
		expect(html).toContain('src="#"');
	});

	it("does not let a URL break out of its attribute", () => {
		const html = parseMarkdown('[x](https://example.com" onmouseover="alert(1))\n');
		expect(html).not.toContain('onmouseover="alert(1)"');
		expect(html).toContain("&quot;");
	});
});

describe("parseCsv", () => {
	it("still builds a table from ordinary rows", () => {
		const html = parseCsv("name,age\nAlice,30\nBob,25");
		expect(html).toContain("<th>name</th>");
		expect(html).toContain("<td>Alice</td>");
		expect(html).toContain("<td>Bob</td>");
	});

	it("escapes markup in body cells", () => {
		const html = parseCsv("name\n<img src=x onerror=alert(1)>");
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
	});

	it("escapes markup in header cells", () => {
		const html = parseCsv("<script>alert(1)</script>\nvalue");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;");
	});

	it("handles empty input without throwing", () => {
		expect(() => parseCsv("")).not.toThrow();
		expect(() => parseCsv(null)).not.toThrow();
	});
});
