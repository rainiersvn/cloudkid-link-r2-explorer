import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `<style>` block without `lang="scss"` is handed to the CSS parser as-is.
 * SCSS-only syntax in one of those does not fail the build — esbuild emits a
 * warning and passes the text straight through into the stylesheet, so the
 * rules silently never apply on any browser without native CSS nesting
 * (everything below Chrome 112 / Safari 16.5 / Firefox 117, which the
 * configured build target of chrome87/edge88/firefox78/safari13.1 includes).
 *
 * EmailFolderPage.vue shipped that way: its responsive email-list rules and
 * row hover were emitted verbatim inside `.email-sender {}`.
 */

const SRC = resolve(__dirname, "../../src");

function vueFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((entry) => {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) return vueFiles(full);
		return full.endsWith(".vue") ? [full] : [];
	});
}

/** Every `<style ...>` block in a SFC, with its opening tag attributes. */
function styleBlocks(source: string): { attrs: string; body: string }[] {
	const blocks: { attrs: string; body: string }[] = [];
	const re = /<style([^>]*)>([\s\S]*?)<\/style>/g;
	let match: RegExpExecArray | null;
	while (true) {
		match = re.exec(source);
		if (match === null) break;
		blocks.push({ attrs: match[1], body: match[2] });
	}
	return blocks;
}

/** Strip `/* *\/` comments and quoted strings so scanning sees only syntax. */
function stripNoise(css: string): string {
	return css
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/"(?:[^"\\]|\\.)*"/g, '""')
		.replace(/'(?:[^'\\]|\\.)*'/g, "''");
}

/**
 * A rule opened while already inside a *selector* rule. Nesting inside an
 * at-rule (`@media { .foo {} }`) is ordinary CSS, so only the selector case
 * counts.
 */
function hasSelectorNesting(css: string): boolean {
	const preludes: string[] = [];
	let prelude = "";
	for (const ch of css) {
		if (ch === "{") {
			const enclosing = preludes[preludes.length - 1];
			if (enclosing !== undefined && !enclosing.startsWith("@")) return true;
			preludes.push(prelude.trim());
			prelude = "";
		} else if (ch === "}") {
			preludes.pop();
			prelude = "";
		} else {
			prelude += ch;
		}
	}
	return false;
}

/** `//` line comments — SCSS only. Ignores `://` inside urls. */
function hasLineComments(css: string): boolean {
	return css
		.split("\n")
		.some((line) => /(^|[^:\w])\/\//.test(line.replace(/\s+$/, "")));
}

/** `&` parent-selector references — SCSS only. */
function hasParentSelector(css: string): boolean {
	return /(^|[\s,{}])&/m.test(css);
}

describe("SFC <style> blocks", () => {
	const files = vueFiles(SRC);

	it("finds .vue files to check", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	for (const file of files) {
		const rel = relative(SRC, file);
		const source = readFileSync(file, "utf-8");

		for (const [index, block] of styleBlocks(source).entries()) {
			// `src="..."` blocks import a stylesheet rather than declaring one.
			if (/\bsrc=/.test(block.attrs)) continue;
			if (/\blang\s*=\s*["'](scss|sass|less|stylus)["']/.test(block.attrs)) {
				continue;
			}

			it(`${rel} block ${index + 1} declares lang="scss" if it uses SCSS syntax`, () => {
				const css = stripNoise(block.body);
				const offenders = [
					hasSelectorNesting(css) && "nested rules",
					hasLineComments(css) && "// line comments",
					hasParentSelector(css) && "& parent selectors",
				].filter(Boolean);

				expect(
					offenders,
					`${rel} has a plain <style> block using ${offenders.join(
						", ",
					)}. Add lang="scss" — otherwise these rules are emitted verbatim and never apply on the configured browser targets.`,
				).toEqual([]);
			});
		}
	}
});
