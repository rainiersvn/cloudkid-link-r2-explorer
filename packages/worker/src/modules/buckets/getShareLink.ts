import { OpenAPIRoute } from "chanfana";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../foundation/password";
import type { AppContext, ShareMetadata } from "../../types";

const shareKey = (shareId: string) =>
	`.r2-explorer/sharable-links/${shareId}.json`;

/** How many times to retry the download counter when another request beats us. */
const MAX_CLAIM_ATTEMPTS = 5;

/**
 * Prompt for the share password.
 *
 * The form posts back to the current URL, so nothing from the request is
 * interpolated into this document -- there is no share id, filename or supplied
 * password anywhere in it.
 */
function passwordPrompt(retry: boolean): Response {
	const error = retry
		? '<p class="error" role="alert">That password was not correct.</p>'
		: "";

	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Password required</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    display: flex; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 1rem;
  }
  main { width: 100%; max-width: 22rem; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  label { display: block; margin-bottom: .35rem; font-size: .875rem; }
  input, button {
    width: 100%; box-sizing: border-box; padding: .6rem .7rem;
    font: inherit; border-radius: .4rem;
  }
  input { border: 1px solid currentColor; margin-bottom: .75rem; }
  button { border: 0; background: #6c3fd4; color: #fff; cursor: pointer; }
  .error { color: #c1121f; font-size: .875rem; margin: 0 0 .75rem; }
</style>
</head>
<body>
<main>
  <h1>This file is password protected</h1>
  ${error}
  <form method="post" autocomplete="off">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autofocus required>
    <button type="submit">Open file</button>
  </form>
</main>
</body>
</html>`;

	return new Response(html, {
		status: 401,
		headers: {
			"content-type": "text/html; charset=utf-8",
			// Keep the prompt and anything typed into it out of caches and out of
			// the Referer sent to whatever the file links to.
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
		},
	});
}

export class GetShareLink extends OpenAPIRoute {
	schema = {
		operationId: "get-share-link",
		tags: ["Sharing"],
		summary: "Access shared file",
		security: [], // Public endpoint - no auth required
		request: {
			params: z.object({
				shareId: z.string().describe("10-character share ID"),
			}),
			// Declared but deliberately unused. The app sets raiseUnknownParameters,
			// so leaving it out would turn an old ?password= link into a bare 400
			// instead of the prompt. The value is never read -- see handle().
			query: z.object({
				password: z
					.string()
					.optional()
					.describe("Ignored. Submit the password with the prompt form."),
			}),
		},
		responses: {
			"200": {
				description: "File retrieved successfully",
			},
			"401": {
				description:
					"Password required or incorrect; responds with a prompt form",
			},
			"404": {
				description: "Share link not found",
			},
			"410": {
				description: "Share link expired",
			},
			"403": {
				description: "Download limit reached",
			},
		},
	};

	/**
	 * Increment the download counter, conditional on nobody else having done so.
	 *
	 * The counter used to be a plain read-modify-write, so concurrent downloads
	 * read the same count and wrote back the same increment -- maxDownloads could
	 * be overrun by however many requests overlapped. R2 puts accept an etag
	 * precondition, which turns this into a compare-and-swap: a losing write
	 * returns null, and we re-read and re-check the limit before trying again.
	 *
	 * Returns one shape with optional fields rather than a discriminated union:
	 * the worker's tsconfig disables strictNullChecks, which stops TypeScript
	 * narrowing `{ok: true} | {ok: false}` at the call site.
	 */
	private async claimDownload(
		bucket: R2Bucket,
		shareId: string,
		initial: ShareMetadata,
		initialEtag: string,
	): Promise<{
		ok: boolean;
		reason?: "limit" | "gone" | "contended";
		metadata?: ShareMetadata;
	}> {
		let metadata = initial;
		let etag = initialEtag;

		for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt++) {
			if (
				metadata.maxDownloads &&
				metadata.currentDownloads >= metadata.maxDownloads
			) {
				return { ok: false, reason: "limit" };
			}

			const next: ShareMetadata = {
				...metadata,
				currentDownloads: metadata.currentDownloads + 1,
			};

			const written = await bucket.put(
				shareKey(shareId),
				JSON.stringify(next),
				{
					httpMetadata: { contentType: "application/json" },
					customMetadata: {
						targetBucket: next.bucket,
						targetKey: next.key,
					},
					onlyIf: { etagMatches: etag },
				},
			);

			if (written) return { ok: true, metadata: next };

			const reread = await bucket.get(shareKey(shareId));
			if (!reread) return { ok: false, reason: "gone" };

			metadata = JSON.parse(await reread.text()) as ShareMetadata;
			etag = reread.etag;
		}

		return { ok: false, reason: "contended" };
	}

	async handle(c: AppContext) {
		const data = await this.getValidatedData<typeof this.schema>();
		const shareId = data.params.shareId;

		// Search every bound bucket for the share metadata. Done concurrently:
		// this used to await each bucket in turn, so a share in the last binding
		// paid the full round-trip of every bucket before it.
		const buckets = Object.entries(c.env).filter(
			([name, value]) =>
				name !== "ASSETS" && typeof (value as R2Bucket)?.get === "function",
		) as [string, R2Bucket][];

		const hits = await Promise.all(
			buckets.map(async ([, candidate]) => {
				const object = await candidate.get(shareKey(shareId));
				return object ? { bucket: candidate, object } : null;
			}),
		);

		const hit = hits.find((entry) => entry !== null);

		if (!hit) {
			throw new HTTPException(404, {
				message: "Share link not found",
			});
		}

		const { bucket, object } = hit;
		const shareMetadata = JSON.parse(await object.text()) as ShareMetadata;

		// Check expiration
		if (shareMetadata.expiresAt && Date.now() > shareMetadata.expiresAt) {
			throw new HTTPException(410, {
				message: "Share link expired",
			});
		}

		// Check download limit before asking for a password, so an exhausted link
		// does not invite guesses at one.
		if (
			shareMetadata.maxDownloads &&
			shareMetadata.currentDownloads >= shareMetadata.maxDownloads
		) {
			throw new HTTPException(403, {
				message: "Download limit reached",
			});
		}

		// Validate password if required.
		//
		// The password arrives in a POST body, never a query string: a query
		// string is recorded in access logs, browser history and the Referer of
		// whatever the downloaded file links to.
		if (shareMetadata.passwordHash) {
			if (c.req.method !== "POST") {
				return passwordPrompt(false);
			}

			const form = await c.req.parseBody();
			const supplied = typeof form.password === "string" ? form.password : "";

			if (!supplied) {
				return passwordPrompt(false);
			}

			const { valid, needsRehash } = await verifyPassword(
				supplied,
				shareMetadata.passwordHash,
			);

			if (!valid) {
				return passwordPrompt(true);
			}

			if (needsRehash) {
				// Upgrade the stored hash now that we have the plaintext in hand.
				// Best effort: a failure here must not block the download, and the
				// next successful unlock will try again.
				try {
					shareMetadata.passwordHash = await hashPassword(supplied);
				} catch {
					// Keep the existing hash and carry on.
				}
			}
		}

		// Confirm the file is there before spending a download on it, but with a
		// head() rather than a get(): claiming the download can still fail below,
		// and an opened body that nothing reads leaks the stream.
		const exists = await bucket.head(shareMetadata.key);

		if (!exists) {
			throw new HTTPException(404, {
				message: "Shared file not found",
			});
		}

		const claim = await this.claimDownload(
			bucket,
			shareId,
			shareMetadata,
			object.etag,
		);

		if (!claim.ok) {
			if (claim.reason === "limit") {
				throw new HTTPException(403, { message: "Download limit reached" });
			}
			if (claim.reason === "gone") {
				throw new HTTPException(404, { message: "Share link not found" });
			}
			throw new HTTPException(503, {
				message: "Share link is busy, please retry",
			});
		}

		// Only now open the body -- the download is already accounted for.
		const file = await bucket.get(shareMetadata.key);

		if (!file) {
			// Deleted between the head() above and here.
			throw new HTTPException(404, {
				message: "Shared file not found",
			});
		}

		// Return the file with proper headers
		const headers = new Headers();
		file.writeHttpMetadata(headers);
		headers.set("etag", file.httpEtag);

		// Add content disposition for download
		const fileName = shareMetadata.key.split("/").pop() || "download";
		headers.set(
			"Content-Disposition",
			`attachment; filename="${encodeURIComponent(fileName)}"`,
		);

		// A shared file is not something an intermediary should hold on to, and
		// the referrer of a protected download should not carry this URL onward.
		headers.set("cache-control", "no-store");
		headers.set("referrer-policy", "no-referrer");

		return new Response(file.body, {
			headers,
		});
	}
}
