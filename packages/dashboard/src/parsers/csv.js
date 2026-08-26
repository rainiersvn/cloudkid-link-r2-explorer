import { escapeHtml } from "../sanitize";

/**
 * Render a CSV file as an HTML table.
 *
 * Lifted out of FilePreview.vue so the escaping below is unit-testable. Cell
 * contents are escaped because the result is handed to v-html, and CSV files
 * come from buckets that accept unauthenticated writes.
 */
export const parseCsv = (text) => {
	const rows = String(text ?? "").split("\n");
	if (rows.length === 0) {
		return "<h2>Empty csv</h2>";
	}

	let result = "";
	for (const [index, row] of rows.entries()) {
		let line = "";
		const columns = row
			.split(/(\s*"[^"]+"\s*|\s*[^,]+|,)(?=,|$)/g)
			.filter((item) => {
				return item !== "" && item !== ",";
			});

		for (const col of columns) {
			const cell = escapeHtml(col.replaceAll('"', ""));
			line += index === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`;
		}

		result += `<tr>${line}</tr>`;
	}

	return `<table class="table">${result}</table>`;
};
