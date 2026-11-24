import { createExecutionContext, env } from "cloudflare:test";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { createTestApp } from "./setup";

const origin = "https://explorer.example";
const bindings = {
	...env,
	GOOGLE_CLIENT_ID: "test-client",
	GOOGLE_CLIENT_SECRET: "test-secret",
	GOOGLE_ALLOWED_EMAILS: "member@example.com",
	SESSION_SECRET: "a-test-only-secret-of-at-least-32-bytes",
};
const app = createTestApp({ googleOAuth: true });
function request(path: string, init?: RequestInit, overrides = {}) {
	return app.fetch(
		new Request(origin + path, init),
		{ ...bindings, ...overrides },
		createExecutionContext(),
	);
}
afterEach(() => vi.unstubAllGlobals());

it("protects dashboard, API and old Access clients even with incomplete configuration", async () => {
	const login = await request("/");
	expect(login.status).toBe(200);
	expect(login.headers.get("content-type")).toContain("text/html");
	const markup = await login.text();
	expect(markup).toContain("A quieter way to explore");
	expect(markup).toContain('href="/auth/google/start"');
	expect(markup).toContain("@media (max-width: 820px)");
	expect((await request("/favicon.ico")).status).toBe(204);
	expect(
		(
			await request("/api/server/config", {
				headers: { "Cf-Access-Jwt-Assertion": "old" },
			})
		).status,
	).toBe(401);
	expect(
		(await request("/api/buckets/test", {}, { GOOGLE_ALLOWED_EMAILS: "" }))
			.status,
	).toBe(503);
	expect(
		(await request("/auth/google/callback?code=code&state=wrong")).status,
	).toBe(400);
	expect((await request("/api/health")).status).toBe(200);
});

it("exchanges a PKCE code, checks the roster and issues a scoped session", async () => {
	const start = await request("/auth/google/start");
	const authorize = new URL(start.headers.get("location") || "");
	const params = authorize.searchParams;
	expect(params.get("redirect_uri")).toBe(`${origin}/auth/google/callback`);
	expect(params.get("code_challenge_method")).toBe("S256");
	const flow = (start.headers.get("set-cookie") || "").split(";")[0] || "";
	const { publicKey, privateKey } = await generateKeyPair("RS256");
	const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" };
	const idToken = await new SignJWT({
		email: "member@example.com",
		email_verified: true,
		nonce: params.get("nonce"),
	})
		.setSubject("account")
		.setAudience(bindings.GOOGLE_CLIENT_ID)
		.setIssuer("https://accounts.google.com")
		.setExpirationTime("5m")
		.setProtectedHeader({ alg: "RS256", kid: "test" })
		.sign(privateKey);
	vi.stubGlobal("fetch", async (url, init) => {
		if (String(url).includes("/certs")) return Response.json({ keys: [jwk] });
		expect(String(url)).toBe("https://oauth2.googleapis.com/token");
		expect(init.body.get("code_verifier")).toHaveLength(43);
		return Response.json({ id_token: idToken });
	});
	const callback = `/auth/google/callback?code=test&state=${params.get("state")}`;
	expect(
		(
			await request(
				callback,
				{ headers: { cookie: flow } },
				{ GOOGLE_ALLOWED_EMAILS: "other@example.com" },
			)
		).status,
	).toBe(403);
	const signedIn = await request(callback, { headers: { cookie: flow } });
	expect(signedIn.status).toBe(302);
	const cookie =
		signedIn.headers
			.getSetCookie()
			.find((value) => value.startsWith("__Host-r2_session=")) || "";
	expect(cookie).toContain("HttpOnly");
	const headers = { cookie: cookie.split(";")[0] || "" };
	expect((await request("/api/server/config", { headers })).status).toBe(200);
	expect(
		(
			await request(
				"/api/server/config",
				{ headers },
				{ GOOGLE_ALLOWED_EMAILS: "other@example.com" },
			)
		).status,
	).toBe(401);
	expect(
		(await request("/auth/logout", { method: "POST", headers })).status,
	).toBe(403);
	const logout = await request("/auth/logout", {
		method: "POST",
		headers: { ...headers, origin },
	});
	expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
});
