/**
 * Escaping helpers for the preview components.
 *
 * Bucket contents are untrusted input: the worker's email handler writes every
 * inbound message and attachment to R2 without authentication, and uploads are
 * open whenever the instance is not in readonly mode. Anything from a bucket
 * that reaches v-html therefore has to be escaped on the way in, or rendered as
 * a text interpolation instead.
 */

const HTML_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Escape the five characters that let text break out of markup or an attribute. */
export const escapeHtml = (value) =>
	String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);

/**
 * Reduce a URL to something that cannot execute script from an href or src.
 *
 * Only schemes that are inert in a document context are allowed through;
 * javascript:, data: and vbscript: collapse to "#". Relative URLs are kept as
 * they are, since they cannot be read as a scheme.
 *
 * Expects input that has already been through escapeHtml -- callers escape the
 * whole document once up front -- so it does not escape again.
 */
export const safeUrl = (value) => {
	const url = String(value ?? "").trim();

	// Browsers ignore whitespace and control characters when resolving a scheme,
	// so a tab in the middle of "java<TAB>script:" still runs. Drop everything
	// outside printable ASCII before deciding, but return the original either way.
	const scheme = url
		.split("")
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code > 32 && code !== 127;
		})
		.join("")
		.toLowerCase();

	if (/^(?:https?|mailto|tel):/.test(scheme)) return url;
	if (/^[a-z][a-z0-9+.-]*:/.test(scheme)) return "#";

	return url;
};
