import type { Next } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
	type JWTPayload,
	SignJWT,
	base64url,
	createRemoteJWKSet,
	jwtVerify,
} from "jose";
import type { AppContext } from "../types";

const keys = createRemoteJWKSet(
	new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const callback = "/auth/google/callback";
const flowCookie = "__Host-r2_flow";
const sessionCookie = "__Host-r2_session";
const encoder = new TextEncoder();
const cookieOptions = {
	secure: true,
	httpOnly: true,
	sameSite: "Lax",
	path: "/",
} as const;

function randomToken() {
	return base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
}

interface Bindings {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_ALLOWED_EMAILS?: string;
	SESSION_SECRET?: string;
}

export async function googleAuth(c: AppContext, next: Next) {
	const path = c.req.path;
	if (path === "/api/health" || /^\/share\/[^/]+$/.test(path)) return next();
	const env: Bindings = c.env as Bindings;
	const origin = new URL(c.req.url).origin;
	const roster = new Set(
		(env.GOOGLE_ALLOWED_EMAILS || "")
			.toLowerCase()
			.split(",")
			.map((email) => email.trim())
			.filter(Boolean),
	);
	c.header("Cache-Control", "private, no-store");
	if (
		!env.GOOGLE_CLIENT_ID ||
		!env.GOOGLE_CLIENT_SECRET ||
		!env.SESSION_SECRET ||
		env.SESSION_SECRET.length < 32 ||
		!roster.size
	) {
		return c.text("Google sign-in is not configured.", 503);
	}
	const secret = encoder.encode(env.SESSION_SECRET);
	async function read(name: string) {
		try {
			const token = getCookie(c, name);
			if (token)
				return (
					await jwtVerify(token, secret, {
						algorithms: ["HS256"],
						issuer: origin,
						audience: name,
						requiredClaims: ["exp"],
					})
				).payload;
		} catch {
			// An expired or malformed cookie starts a new login.
		}
	}
	async function issue(name: string, claims: JWTPayload, seconds: number) {
		const token = await new SignJWT(claims)
			.setProtectedHeader({ alg: "HS256" })
			.setAudience(name)
			.setIssuer(origin)
			.setIssuedAt()
			.setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
			.sign(secret);
		setCookie(c, name, token, { ...cookieOptions, maxAge: seconds });
	}

	if (
		!["GET", "HEAD", "OPTIONS"].includes(c.req.method) &&
		c.req.header("Origin") !== origin
	)
		return c.text("Same-origin request required.", 403);
	if (path === "/auth/logout" && c.req.method === "POST") {
		setCookie(c, sessionCookie, "", { ...cookieOptions, maxAge: 0 });
		return c.redirect("/", 303);
	}
	if (path === "/auth/google/start" && c.req.method === "GET") {
		const state = randomToken();
		const nonce = randomToken();
		const verifier = randomToken();
		const challenge = base64url.encode(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", encoder.encode(verifier)),
			),
		);
		await issue(flowCookie, { state, nonce, verifier }, 600);
		const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
		url.search = new URLSearchParams({
			client_id: env.GOOGLE_CLIENT_ID,
			redirect_uri: origin + callback,
			response_type: "code",
			scope: "openid email",
			prompt: "select_account",
			state,
			nonce,
			code_challenge: challenge,
			code_challenge_method: "S256",
		}).toString();
		return c.redirect(url.href);
	}
	if (path === callback && c.req.method === "GET") {
		const flow = await read(flowCookie);
		setCookie(c, flowCookie, "", { ...cookieOptions, maxAge: 0 });
		const code = c.req.query("code");
		if (
			!flow ||
			typeof flow.verifier !== "string" ||
			typeof flow.nonce !== "string" ||
			flow.state !== c.req.query("state") ||
			!code
		)
			return c.text(
				"Sign-in expired or was cancelled. Open Explorer to try again.",
				400,
			);
		try {
			const response = await fetch("https://oauth2.googleapis.com/token", {
				method: "POST",
				body: new URLSearchParams({
					grant_type: "authorization_code",
					code,
					client_id: env.GOOGLE_CLIENT_ID,
					client_secret: env.GOOGLE_CLIENT_SECRET,
					redirect_uri: origin + callback,
					code_verifier: flow.verifier,
				}),
			});
			if (!response.ok) return c.text("Google sign-in failed.", 401);
			const { id_token } = await response.json<{ id_token: string }>();
			const { payload } = await jwtVerify(id_token, keys, {
				algorithms: ["RS256"],
				issuer: ["accounts.google.com", "https://accounts.google.com"],
				audience: env.GOOGLE_CLIENT_ID,
				requiredClaims: ["exp", "sub", "nonce"],
			});
			if (
				!payload.sub ||
				payload.nonce !== flow.nonce ||
				payload.email_verified !== true ||
				typeof payload.email !== "string" ||
				!roster.has(payload.email.toLowerCase())
			)
				return c.text("This Google account cannot access Explorer.", 403);
			await issue(
				sessionCookie,
				{ sub: payload.sub, email: payload.email.toLowerCase() },
				86400,
			);
			return c.redirect("/");
		} catch {
			return c.text("Google sign-in could not be verified.", 401);
		}
	}
	const session = await read(sessionCookie);
	if (
		!session?.sub ||
		typeof session.email !== "string" ||
		!roster.has(session.email)
	) {
		if (path.startsWith("/api/"))
			return c.json({ error: "google_sign_in_required" }, 401);
		return c.html(
			'<!doctype html><title>Sign in to R2 Explorer</title><main><h1>R2 Explorer</h1><a href="/auth/google/start">Sign in with Google</a></main>',
			401,
		);
	}
	c.set("authentication_type", "google");
	c.set("authentication_username", session.email);
	await next();
}
