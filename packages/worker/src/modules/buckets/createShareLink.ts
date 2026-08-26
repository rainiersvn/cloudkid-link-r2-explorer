import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hashPassword } from "../../foundation/password";
import type { AppContext, ShareMetadata } from "../../types";

export class CreateShareLink extends OpenAPIRoute {
	schema = {
		operationId: "post-bucket-create-share-link",
		tags: ["Buckets"],
		summary: "Create shareable link for file",
		request: {
			params: z.object({
				bucket: z.string(),
				key: z.string(),
			}),
			body: {
				content: {
					"application/json": {
						schema: z.object({
							expiresIn: z
								.number()
								.optional()
								.describe("Expiration time in seconds"),
							// A share password is the only thing standing between a leaked
							// link and the file once /share/* is public, and guessing is
							// throttled but not impossible. Refuse trivially short ones; the
							// throttle in getShareLink is the defence against the rest.
							password: z
								.string()
								.min(8, "Share password must be at least 8 characters")
								.optional()
								.describe("Optional password (minimum 8 characters)"),
							maxDownloads: z.number().optional().describe("Maximum downloads"),
						}),
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Share link created successfully",
				content: {
					"application/json": {
						schema: z.object({
							shareId: z.string(),
							shareUrl: z.string(),
							expiresAt: z.number().optional(),
						}),
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();

		const bucketName = data.params.bucket;
		const bucket = c.env[bucketName] as R2Bucket | undefined;

		if (!bucket) {
			throw new HTTPException(500, {
				message: `Bucket binding not found: ${bucketName}`,
			});
		}

		const key = decodeURIComponent(escape(atob(data.params.key)));

		// Verify the file exists
		const fileExists = await bucket.head(key);
		if (!fileExists) {
			throw new HTTPException(404, {
				message: `File not found: ${key}`,
			});
		}

		// Generate a unique share ID.
		//
		// For a share with no password the ID is the entire secret, and once
		// Access bypasses /share/* anyone on the internet can try to guess it. The
		// old ID was a UUID truncated to 10 hex chars -- 40 bits -- which is too
		// little to guard media, receipts and consent files against enumeration.
		// Use 128 bits of randomness instead. Existing 10-char links still resolve:
		// lookup is by exact key, so length is irrelevant to old shares.
		let shareId = "";
		let attempts = 0;
		const maxAttempts = 5;

		while (attempts < maxAttempts) {
			shareId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
				byte.toString(16).padStart(2, "0"),
			).join("");
			const existingShare = await bucket.head(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			if (!existingShare) {
				break;
			}
			attempts++;
		}

		if (attempts === maxAttempts) {
			throw new HTTPException(500, {
				message: "Failed to generate unique share ID",
			});
		}

		const passwordHash = data.body.password
			? await hashPassword(data.body.password)
			: undefined;

		// Calculate expiration timestamp
		const expiresAt = data.body.expiresIn
			? Date.now() + data.body.expiresIn * 1000
			: undefined;

		// Create share metadata
		const shareMetadata: ShareMetadata = {
			bucket: bucketName,
			key: key,
			expiresAt: expiresAt,
			passwordHash: passwordHash,
			maxDownloads: data.body.maxDownloads,
			currentDownloads: 0,
			createdBy: c.get("authentication_username") || "anonymous",
			createdAt: Date.now(),
		};

		// Store share metadata in R2
		await bucket.put(
			`.r2-explorer/sharable-links/${shareId}.json`,
			JSON.stringify(shareMetadata),
			{
				httpMetadata: { contentType: "application/json" },
				customMetadata: {
					targetBucket: bucketName,
					targetKey: key,
				},
			},
		);

		// Construct share URL
		const shareUrl = `${new URL(c.req.url).origin}/share/${shareId}`;

		return c.json({
			shareId,
			shareUrl,
			expiresAt,
		});
	}
}
