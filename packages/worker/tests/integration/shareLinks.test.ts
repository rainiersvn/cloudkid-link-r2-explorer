import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, createTestRequest } from "./setup";

describe("Share Links Endpoints", () => {
	let app: ReturnType<typeof createTestApp>;
	let MY_TEST_BUCKET_1: R2Bucket;
	const testFileName = "test-file.txt";
	const testFileContent = "Hello World - Test File";

	beforeEach(async () => {
		app = createTestApp();
		MY_TEST_BUCKET_1 = env.MY_TEST_BUCKET_1;

		// Clean up bucket before each test
		if (MY_TEST_BUCKET_1) {
			const listed = await MY_TEST_BUCKET_1.list();
			const keysToDelete = listed.objects.map((obj) => obj.key);
			if (keysToDelete.length > 0) {
				await MY_TEST_BUCKET_1.delete(keysToDelete);
			}
		}

		// Create a test file
		await MY_TEST_BUCKET_1.put(testFileName, testFileContent);
	});

	afterEach(async () => {
		if (MY_TEST_BUCKET_1) {
			const listed = await MY_TEST_BUCKET_1.list();
			const keysToDelete = listed.objects.map((obj) => obj.key);
			if (keysToDelete.length > 0) {
				await MY_TEST_BUCKET_1.delete(keysToDelete);
			}
		}
	});

	describe("Create Share Link (POST /api/buckets/:bucket/:key/share)", () => {
		it.skip("should create a basic share link without options", async () => {
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				shareId: string;
				shareUrl: string;
				expiresAt?: number;
			};

			expect(body.shareId).toBeDefined();
			expect(body.shareId).toHaveLength(10);
			expect(body.shareUrl).toContain(`/share/${body.shareId}`);
			expect(body.expiresAt).toBeUndefined();

			// Verify share metadata was stored
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			expect(shareMetadata).toBeDefined();
		});

		it("should create share link with expiration", async () => {
			const encodedKey = btoa(testFileName);
			const expiresIn = 3600; // 1 hour
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ expiresIn },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				shareId: string;
				shareUrl: string;
				expiresAt?: number;
			};

			expect(body.expiresAt).toBeDefined();
			expect(body.expiresAt).toBeGreaterThan(Date.now());
			expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + expiresIn * 1000);

			// Verify metadata includes expiration
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.expiresAt).toBe(body.expiresAt);
		});

		it("should create share link with password", async () => {
			const encodedKey = btoa(testFileName);
			const password = "test-password-123";
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ password },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as { shareId: string };

			// Verify password is hashed in metadata
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.passwordHash).toBeDefined();
			expect(metadata.passwordHash).not.toBe(password); // Should be hashed

			// pbkdf2$<iterations>$<salt>$<derived key>. The old format was a bare
			// SHA-256 digest, which is a rainbow-table lookup from the plaintext
			// for anyone who gets at the metadata object.
			const [scheme, iterations, salt, derived] =
				metadata.passwordHash.split("$");
			expect(scheme).toBe("pbkdf2");
			expect(Number(iterations)).toBeGreaterThanOrEqual(210_000);
			expect(salt).toMatch(/^[0-9a-f]{32}$/);
			expect(derived).toMatch(/^[0-9a-f]{64}$/);
		});

		it("salts each password, so identical passwords hash differently", async () => {
			const encodedKey = btoa(testFileName);
			const password = "same-password";

			const hashes: string[] = [];
			for (let i = 0; i < 2; i++) {
				const response = await app.fetch(
					createTestRequest(
						`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
						"POST",
						{ password },
					),
					env,
					createExecutionContext(),
				);
				const body = (await response.json()) as { shareId: string };
				const stored = await MY_TEST_BUCKET_1.get(
					`.r2-explorer/sharable-links/${body.shareId}.json`,
				);
				hashes.push(JSON.parse((await stored?.text()) || "{}").passwordHash);
			}

			expect(hashes[0]).not.toBe(hashes[1]);
		});

		it("should create share link with max downloads", async () => {
			const encodedKey = btoa(testFileName);
			const maxDownloads = 5;
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ maxDownloads },
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as { shareId: string };

			// Verify max downloads in metadata
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.maxDownloads).toBe(maxDownloads);
			expect(metadata.currentDownloads).toBe(0);
		});

		it("should return 404 for non-existent file", async () => {
			const encodedKey = btoa("non-existent-file.txt");
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should create share link with all options", async () => {
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{
					expiresIn: 7200,
					password: "secure-password",
					maxDownloads: 10,
				},
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(200);

			const body = (await response.json()) as {
				shareId: string;
				expiresAt: number;
			};

			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${body.shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");

			expect(metadata.expiresAt).toBeDefined();
			expect(metadata.passwordHash).toBeDefined();
			expect(metadata.maxDownloads).toBe(10);
			expect(metadata.bucket).toBe("MY_TEST_BUCKET_1");
			expect(metadata.key).toBe(testFileName);
			expect(metadata.currentDownloads).toBe(0);
		});
	});

	describe("Access Share Link (GET /share/:shareId)", () => {
		let shareId: string;

		beforeEach(async () => {
			// Create a share for testing
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };
			shareId = body.shareId;
		});

		it("should access public share link without authentication", async () => {
			const request = new Request(`http://localhost/share/${shareId}`, {
				method: "GET",
			});

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const content = await response.text();
			expect(content).toBe(testFileContent);
			expect(response.headers.get("Content-Disposition")).toContain(
				testFileName,
			);
		});

		it.skip("should increment download counter on access", async () => {
			const request = new Request(`http://localhost/share/${shareId}`, {
				method: "GET",
			});

			await app.fetch(request, env, createExecutionContext());
			await app.fetch(request, env, createExecutionContext());

			// Check download counter
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const metadata = JSON.parse((await shareMetadata?.text()) || "{}");
			expect(metadata.currentDownloads).toBe(2);
		});

		it("should return 404 for non-existent share", async () => {
			const request = new Request("http://localhost/share/nonexistent", {
				method: "GET",
			});

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should return 410 for expired share", async () => {
			// Create expired share
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ expiresIn: -1 }, // Already expired
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };

			// Try to access expired share
			const accessRequest = new Request(
				`http://localhost/share/${body.shareId}`,
				{ method: "GET" },
			);
			const accessResponse = await app.fetch(
				accessRequest,
				env,
				createExecutionContext(),
			);

			expect(accessResponse.status).toBe(410);
		});

		it.skip("should enforce download limits", async () => {
			// Create share with max 2 downloads
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ maxDownloads: 2 },
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };

			// Download twice (should work)
			const accessRequest1 = new Request(
				`http://localhost/share/${body.shareId}`,
				{ method: "GET" },
			);
			const accessRequest2 = new Request(
				`http://localhost/share/${body.shareId}`,
				{ method: "GET" },
			);
			const accessRequest3 = new Request(
				`http://localhost/share/${body.shareId}`,
				{ method: "GET" },
			);

			const response1 = await app.fetch(
				accessRequest1,
				env,
				createExecutionContext(),
			);
			const response2 = await app.fetch(
				accessRequest2,
				env,
				createExecutionContext(),
			);
			const response3 = await app.fetch(
				accessRequest3,
				env,
				createExecutionContext(),
			);

			expect(response1.status).toBe(200);
			expect(response2.status).toBe(200);
			expect(response3.status).toBe(403); // Limit reached
		});

		it("does not overrun maxDownloads under concurrent access", async () => {
			const maxDownloads = 2;
			const response = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{ maxDownloads },
				),
				env,
				createExecutionContext(),
			);
			const { shareId } = (await response.json()) as { shareId: string };

			// Six requests started together. With the old read-modify-write counter
			// they all read currentDownloads: 0 and all wrote back 1, so every one
			// of them was served. The etag precondition makes the losers re-read.
			const responses = await Promise.all(
				Array.from({ length: 6 }, () =>
					app.fetch(
						new Request(`http://localhost/share/${shareId}`, { method: "GET" }),
						env,
						createExecutionContext(),
					),
				),
			);

			// Bodies stream from R2; drain them all or isolated storage cannot be
			// torn down at the end of the test.
			const statuses = [];
			for (const result of responses) {
				statuses.push(result.status);
				await result.arrayBuffer();
			}

			expect(statuses.filter((status) => status === 200)).toHaveLength(
				maxDownloads,
			);

			const stored = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const metadata = JSON.parse((await stored?.text()) || "{}");
			expect(metadata.currentDownloads).toBe(maxDownloads);
		});

		// The password travels in a POST body now, not a query string: a query
		// string ends up in access logs, browser history, and the Referer header
		// sent to whatever the downloaded file links to.
		const createProtectedShare = async (password: string) => {
			const response = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{ password },
				),
				env,
				createExecutionContext(),
			);
			return ((await response.json()) as { shareId: string }).shareId;
		};

		const submitPassword = (shareId: string, password: string) =>
			app.fetch(
				new Request(`http://localhost/share/${shareId}`, {
					method: "POST",
					headers: { "content-type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({ password }).toString(),
				}),
				env,
				createExecutionContext(),
			);

		it("prompts for a password instead of serving the file", async () => {
			const shareId = await createProtectedShare("secret123");

			const response = await app.fetch(
				new Request(`http://localhost/share/${shareId}`, { method: "GET" }),
				env,
				createExecutionContext(),
			);

			expect(response.status).toBe(401);
			expect(response.headers.get("content-type")).toContain("text/html");

			const html = await response.text();
			expect(html).toContain('name="password"');
			// The file itself must not leak into the prompt.
			expect(html).not.toContain(testFileContent);
		});

		it("rejects a wrong password", async () => {
			const shareId = await createProtectedShare("secret123");
			const response = await submitPassword(shareId, "wrong");

			expect(response.status).toBe(401);
			expect(await response.text()).toContain("not correct");
		});

		it("serves the file for the right password", async () => {
			const shareId = await createProtectedShare("secret123");
			const response = await submitPassword(shareId, "secret123");

			expect(response.status).toBe(200);
			expect(await response.text()).toBe(testFileContent);
		});

		it("ignores a password supplied in the query string", async () => {
			const shareId = await createProtectedShare("secret123");

			const response = await app.fetch(
				new Request(`http://localhost/share/${shareId}?password=secret123`, {
					method: "GET",
				}),
				env,
				createExecutionContext(),
			);

			// Still the prompt, never the file -- otherwise the query-string leak
			// this change exists to close would still be reachable.
			expect(response.status).toBe(401);
			expect(await response.text()).not.toContain(testFileContent);
		});

		it("accepts a legacy SHA-256 hash and upgrades it on use", async () => {
			const password = "legacy-secret";
			const shareId = "legacy0001";
			const shareKey = `.r2-explorer/sharable-links/${shareId}.json`;

			// Exactly what createShareLink wrote before this change.
			const digest = await crypto.subtle.digest(
				"SHA-256",
				new TextEncoder().encode(password),
			);
			const legacyHash = Array.from(new Uint8Array(digest))
				.map((b) => b.toString(16).padStart(2, "0"))
				.join("");

			await MY_TEST_BUCKET_1.put(
				shareKey,
				JSON.stringify({
					bucket: "MY_TEST_BUCKET_1",
					key: testFileName,
					passwordHash: legacyHash,
					currentDownloads: 0,
					createdBy: "someone",
					createdAt: Date.now(),
				}),
			);

			const response = await submitPassword(shareId, password);
			expect(response.status).toBe(200);
			expect(await response.text()).toBe(testFileContent);

			// The stored hash should have been replaced with the current scheme, so
			// existing links stop being rainbow-table material once they are used.
			const stored = await MY_TEST_BUCKET_1.get(shareKey);
			const metadata = JSON.parse((await stored?.text()) || "{}");
			expect(metadata.passwordHash).not.toBe(legacyHash);
			expect(metadata.passwordHash.startsWith("pbkdf2$")).toBe(true);

			// ...and the upgraded hash still verifies the same password. The body
			// has to be consumed: it streams from R2, and an unread stream keeps a
			// storage handle open past the test, which fails isolated-storage teardown.
			const again = await submitPassword(shareId, password);
			expect(again.status).toBe(200);
			expect(await again.text()).toBe(testFileContent);
		});

		// These previews reach the internet unauthenticated once Cloudflare Access
		// bypasses /share/*, so the worker is the only control left.

		it("a HEAD request does not spend a download", async () => {
			const maxDownloads = 1;
			const create = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{ maxDownloads },
				),
				env,
				createExecutionContext(),
			);
			const { shareId: limited } = (await create.json()) as {
				shareId: string;
			};

			// The runtime answers HEAD with the GET handler minus the body. If that
			// path claimed a download, a bodyless request would burn the only one.
			const head = await app.fetch(
				new Request(`http://localhost/share/${limited}`, { method: "HEAD" }),
				env,
				createExecutionContext(),
			);
			expect(head.status).toBe(200);
			expect(head.headers.get("Content-Disposition")).toContain(testFileName);
			expect(await head.text()).toBe(""); // HEAD carries no body

			const stored = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${limited}.json`,
			);
			const metadata = JSON.parse((await stored?.text()) || "{}");
			expect(metadata.currentDownloads).toBe(0);

			// The real download is still available afterwards.
			const get = await app.fetch(
				new Request(`http://localhost/share/${limited}`, { method: "GET" }),
				env,
				createExecutionContext(),
			);
			expect(get.status).toBe(200);
			expect(await get.text()).toBe(testFileContent);
		});

		it("a HEAD on a password-protected share stays behind the password", async () => {
			const shareId = await createProtectedShare("secret123");

			const head = await app.fetch(
				new Request(`http://localhost/share/${shareId}`, { method: "HEAD" }),
				env,
				createExecutionContext(),
			);

			// HEAD cannot carry the POST body the password needs, so it must get the
			// prompt's 401 -- never a 200 that would confirm-and-expose the file.
			expect(head.status).toBe(401);
			expect(await head.text()).toBe("");
		});

		it("serves a download with anti-sniffing and no-index headers", async () => {
			const create = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);
			const { shareId } = (await create.json()) as { shareId: string };

			const response = await app.fetch(
				new Request(`http://localhost/share/${shareId}`, { method: "GET" }),
				env,
				createExecutionContext(),
			);
			await response.arrayBuffer();

			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
			expect(response.headers.get("x-robots-tag")).toContain("noindex");
			expect(response.headers.get("content-security-policy")).toContain(
				"default-src 'none'",
			);
			expect(response.headers.get("content-disposition")).toContain(
				"attachment",
			);
		});

		it("locks the share after ten wrong passwords, then refuses guesses", async () => {
			const shareId = await createProtectedShare("secret123");

			// Ten misses. The tenth crosses the threshold and locks the share.
			for (let i = 0; i < 10; i++) {
				const r = await submitPassword(shareId, `wrong-${i}`);
				// The first nine are ordinary prompts; the tenth is the lockout.
				expect([401, 429]).toContain(r.status);
				await r.text();
			}

			// Locked: even the correct password is refused now, with a Retry-After.
			const blocked = await submitPassword(shareId, "secret123");
			expect(blocked.status).toBe(429);
			expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);

			const stored = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const metadata = JSON.parse((await stored?.text()) || "{}");
			expect(metadata.failedAttempts).toBeGreaterThanOrEqual(10);
			expect(metadata.lockedUntil).toBeGreaterThan(Date.now());
		});

		it("a correct password before the lockout clears the failure count", async () => {
			const shareId = await createProtectedShare("secret123");

			for (let i = 0; i < 3; i++) {
				await (await submitPassword(shareId, "nope")).text();
			}

			// The misses were actually counted (otherwise this test would pass even
			// with the throttle removed, and prove nothing).
			const afterMisses = JSON.parse(
				(await (
					await MY_TEST_BUCKET_1.get(
						`.r2-explorer/sharable-links/${shareId}.json`,
					)
				)?.text()) || "{}",
			);
			expect(afterMisses.failedAttempts).toBe(3);

			const ok = await submitPassword(shareId, "secret123");
			expect(ok.status).toBe(200);
			await ok.text();

			const stored = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			const metadata = JSON.parse((await stored?.text()) || "{}");
			// Reset to 0, so the next visitor starts with a full budget.
			expect(metadata.failedAttempts).toBe(0);
			expect(metadata.lockedUntil).toBeUndefined();
		});

		it("rejects creating a share with a too-short password", async () => {
			const prefix = ".r2-explorer/sharable-links/";
			const before = (await MY_TEST_BUCKET_1.list({ prefix })).objects.length;

			const response = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{ password: "short" },
				),
				env,
				createExecutionContext(),
			);
			expect(response.status).toBe(400);

			// The rejected request wrote no new share record.
			const after = (await MY_TEST_BUCKET_1.list({ prefix })).objects.length;
			expect(after).toBe(before);
		});

		it("does not 503 an unlimited share under heavy concurrency", async () => {
			// No maxDownloads: the counter is analytics, so the strict compare-and-
			// swap must not apply -- otherwise a gallery link opened by many people
			// at once exhausts the retry budget and 503s real recipients.
			const create = await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${btoa(testFileName)}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);
			const { shareId } = (await create.json()) as { shareId: string };

			const responses = await Promise.all(
				Array.from({ length: 12 }, () =>
					app.fetch(
						new Request(`http://localhost/share/${shareId}`, { method: "GET" }),
						env,
						createExecutionContext(),
					),
				),
			);

			const statuses: number[] = [];
			for (const result of responses) {
				statuses.push(result.status);
				await result.arrayBuffer();
			}

			expect(statuses.every((status) => status === 200)).toBe(true);
		});
	});

	describe("List Shares (GET /api/buckets/:bucket/shares)", () => {
		it("should list all shares in bucket", async () => {
			// Create multiple shares
			const encodedKey = btoa(testFileName);

			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);

			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ maxDownloads: 5 },
				),
				env,
				createExecutionContext(),
			);

			// List shares
			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as {
				shares: Array<{
					shareId: string;
					shareUrl: string;
					key: string;
					isExpired: boolean;
					hasPassword: boolean;
				}>;
			};

			expect(body.shares).toHaveLength(2);
			expect(body.shares[0].shareId).toBeDefined();
			expect(body.shares[0].shareUrl).toContain("/share/");
			expect(body.shares[0].key).toBe(testFileName);
			expect(body.shares[0].isExpired).toBe(false);
		});

		it("should return empty array for bucket with no shares", async () => {
			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as { shares: Array<unknown> };
			expect(body.shares).toHaveLength(0);
		});

		it("should show expired status for shares", async () => {
			// Create expired share
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{ expiresIn: -1 },
			);
			await app.fetch(request, env, createExecutionContext());

			// List shares
			const listRequest = createTestRequest(
				"/api/buckets/MY_TEST_BUCKET_1/shares",
			);
			const response = await app.fetch(
				listRequest,
				env,
				createExecutionContext(),
			);
			const body = (await response.json()) as {
				shares: Array<{ isExpired: boolean }>;
			};

			expect(body.shares[0].isExpired).toBe(true);
		});

		it("should indicate password protection status", async () => {
			const encodedKey = btoa(testFileName);

			// Create share with password (>= 8 chars, the creation-time minimum)
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{ password: "secret123" },
				),
				env,
				createExecutionContext(),
			);

			// Create share without password
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
					"POST",
					{},
				),
				env,
				createExecutionContext(),
			);

			const request = createTestRequest("/api/buckets/MY_TEST_BUCKET_1/shares");
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as {
				shares: Array<{ hasPassword: boolean }>;
			};

			expect(body.shares).toHaveLength(2);
			expect(body.shares.some((s) => s.hasPassword === true)).toBe(true);
			expect(body.shares.some((s) => s.hasPassword === false)).toBe(true);
		});
	});

	describe("Delete Share Link (DELETE /api/buckets/:bucket/share/:shareId)", () => {
		let shareId: string;

		beforeEach(async () => {
			// Create a share for testing
			const encodedKey = btoa(testFileName);
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/${encodedKey}/share`,
				"POST",
				{},
			);
			const response = await app.fetch(request, env, createExecutionContext());
			const body = (await response.json()) as { shareId: string };
			shareId = body.shareId;
		});

		it("should delete/revoke a share link", async () => {
			const request = createTestRequest(
				`/api/buckets/MY_TEST_BUCKET_1/share/${shareId}`,
				"DELETE",
			);

			const response = await app.fetch(request, env, createExecutionContext());

			expect(response.status).toBe(200);
			const body = (await response.json()) as { success: boolean };
			expect(body.success).toBe(true);

			// Verify share metadata was deleted
			const shareMetadata = await MY_TEST_BUCKET_1.get(
				`.r2-explorer/sharable-links/${shareId}.json`,
			);
			expect(shareMetadata).toBeNull();
		});

		it("should return 404 when deleting non-existent share", async () => {
			const request = createTestRequest(
				"/api/buckets/MY_TEST_BUCKET_1/share/nonexistent",
				"DELETE",
			);

			const response = await app.fetch(request, env, createExecutionContext());
			expect(response.status).toBe(404);
		});

		it("should make share inaccessible after deletion", async () => {
			// Delete the share
			await app.fetch(
				createTestRequest(
					`/api/buckets/MY_TEST_BUCKET_1/share/${shareId}`,
					"DELETE",
				),
				env,
				createExecutionContext(),
			);

			// Try to access deleted share
			const accessRequest = new Request(`http://localhost/share/${shareId}`, {
				method: "GET",
			});
			const response = await app.fetch(
				accessRequest,
				env,
				createExecutionContext(),
			);

			expect(response.status).toBe(404);
		});
	});
});
