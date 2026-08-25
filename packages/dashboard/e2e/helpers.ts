import { type APIRequestContext } from "@playwright/test";

const BASE = "http://localhost:8787";
const BUCKET = "MY_BUCKET";

/** Base64-encode a key the same way the dashboard does. */
function encodeKey(key: string): string {
	return btoa(unescape(encodeURIComponent(key)));
}

/**
 * Upload a file to the test bucket via the worker API.
 * The upload endpoint expects raw binary body (application/octet-stream).
 */
export async function uploadFile(
	request: APIRequestContext,
	key: string,
	content: string | Buffer,
	contentType = "text/plain",
) {
	const encoded = encodeKey(key);
	const body =
		typeof content === "string" ? Buffer.from(content, "utf-8") : content;

	const resp = await request.post(
		`${BASE}/api/buckets/${BUCKET}/upload?key=${encoded}`,
		{
			data: body,
			headers: {
				"Content-Type": "application/octet-stream",
			},
		},
	);
	if (!resp.ok()) {
		throw new Error(
			`Upload failed for ${key}: ${resp.status()} ${await resp.text()}`,
		);
	}
}

/**
 * Create a folder in the test bucket.
 */
export async function createFolder(
	request: APIRequestContext,
	folderKey: string,
) {
	const encoded = encodeKey(
		folderKey.endsWith("/") ? folderKey : `${folderKey}/`,
	);
	const resp = await request.post(`${BASE}/api/buckets/${BUCKET}/folder`, {
		data: { key: encoded },
	});
	if (!resp.ok()) {
		throw new Error(
			`Create folder failed for ${folderKey}: ${resp.status()} ${await resp.text()}`,
		);
	}
}

/**
 * Delete an object from the test bucket.
 */
export async function deleteObject(
	request: APIRequestContext,
	key: string,
) {
	const encoded = encodeKey(key);
	await request.post(`${BASE}/api/buckets/${BUCKET}/delete`, {
		data: { key: encoded },
	});
}

/**
 * Upload a test email JSON with proper metadata.
 * Emails are stored at .r2-explorer/emails/inbox/{name}.json
 */
export async function seedEmail(
	request: APIRequestContext,
	name: string,
	opts: {
		subject: string;
		fromName: string;
		fromAddress: string;
		toAddress?: string;
		body?: string;
		html?: string;
		read?: boolean;
		hasAttachments?: boolean;
		date?: string;
	},
) {
	const emailJson = JSON.stringify({
		subject: opts.subject,
		from: { name: opts.fromName, address: opts.fromAddress },
		to: [{ name: "", address: opts.toAddress ?? "test@example.com" }],
		date: opts.date ?? new Date().toISOString(),
		text: opts.body ?? `Body of: ${opts.subject}`,
		html: opts.html ?? `<p>${opts.body ?? opts.subject}</p>`,
		attachments: [],
	});

	const key = `.r2-explorer/emails/inbox/${name}.json`;

	// Upload with custom metadata in the same request (as the receiveEmail handler does)
	const customMeta = {
		subject: opts.subject,
		from_address: opts.fromAddress,
		from_name: opts.fromName,
		to_address: opts.toAddress ?? "test@example.com",
		has_attachments: String(opts.hasAttachments ?? false),
		read: String(opts.read ?? false),
		timestamp: String(Date.now()),
	};

	const encodedKey = encodeKey(key);
	const encodedMeta = btoa(
		unescape(encodeURIComponent(JSON.stringify(customMeta))),
	);

	const resp = await request.post(
		`${BASE}/api/buckets/${BUCKET}/upload?key=${encodedKey}&customMetadata=${encodedMeta}`,
		{
			data: Buffer.from(emailJson, "utf-8"),
			headers: {
				"Content-Type": "application/octet-stream",
			},
		},
	);
	if (!resp.ok()) {
		throw new Error(
			`Seed email failed for ${name}: ${resp.status()} ${await resp.text()}`,
		);
	}
}

/**
 * Clean up all objects with a given prefix.
 */
export async function cleanupPrefix(
	request: APIRequestContext,
	prefix: string,
) {
	const resp = await request.get(
		`${BASE}/api/buckets/${BUCKET}?prefix=${encodeKey(prefix)}&delimiter=/`,
	);
	if (resp.ok()) {
		const data = await resp.json();
		for (const obj of data.objects ?? []) {
			await deleteObject(request, obj.key);
		}
	}
}

export { BUCKET };

/**
 * Build a minimal but valid single-page PDF using a base-14 font.
 *
 * The xref offsets are computed from the assembled body rather than hardcoded,
 * so the file stays loadable if the content stream is ever edited. Encoded as
 * latin1 so string indices and byte offsets agree.
 */
export function minimalPdf(text = "E2E PDF OK"): Buffer {
	const stream = `BT /F1 24 Tf 20 50 Td (${text}) Tj ET\n`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];

	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(pdf.length);
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});

	const startxref = pdf.length;
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
	pdf += `startxref\n${startxref}\n%%EOF\n`;

	return Buffer.from(pdf, "latin1");
}
