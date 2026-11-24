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

function loginPage(message?: string) {
	const notice = message
		? `<p class="notice" role="status">${message}</p>`
		: "";
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b0910">
  <meta name="description" content="Sign in to your Cloudflare R2 workspace.">
  <title>Sign in · R2 Explorer</title>
  <style>
    :root {
      color-scheme: dark;
      font-family: "Aptos", "Segoe UI", sans-serif;
      background: #0b0910;
      color: #f6f2f8;
      font-synthesis: none;
      text-rendering: optimizeLegibility;
      -webkit-font-smoothing: antialiased;
    }
    * { box-sizing: border-box; }
    body {
      min-width: 320px;
      min-height: 100svh;
      margin: 0;
      display: grid;
      place-items: center;
      overflow-x: hidden;
      background:
        radial-gradient(ellipse at 14% 18%, rgba(114, 67, 154, .21), transparent 38rem),
        radial-gradient(ellipse at 87% 82%, rgba(173, 128, 59, .11), transparent 34rem),
        #0b0910;
    }
    body::before {
      position: fixed;
      inset: 0;
      content: "";
      pointer-events: none;
      opacity: .2;
      background-image: linear-gradient(rgba(220, 207, 236, .075) 1px, transparent 1px), linear-gradient(90deg, rgba(220, 207, 236, .075) 1px, transparent 1px);
      background-size: 68px 68px;
      mask-image: linear-gradient(110deg, #000 0%, transparent 78%);
    }
    .shell {
      position: relative;
      width: min(1120px, calc(100% - 64px));
      min-height: 620px;
      display: grid;
      grid-template-columns: 1.05fr .95fr;
      align-items: center;
      gap: clamp(48px, 9vw, 128px);
      padding: 52px 0;
    }
    .story { max-width: 510px; }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 92px; }
    .brand-mark {
      display: grid;
      width: 42px;
      aspect-ratio: 1;
      place-items: center;
      border: 1px solid rgba(212, 174, 246, .32);
      border-radius: 14px;
      background: linear-gradient(145deg, rgba(139, 88, 185, .23), rgba(216, 177, 111, .09));
      box-shadow: 0 8px 30px rgba(0, 0, 0, .28), inset 0 1px rgba(255, 255, 255, .08);
    }
    .brand-name { font: 600 15px/1.2 "Aptos", "Segoe UI", sans-serif; letter-spacing: .02em; }
    .brand-caption { margin-top: 4px; color: #9992a4; font-size: 12px; }
    .eyebrow { display: flex; align-items: center; gap: 10px; color: #c5a9e4; font-size: 11px; font-weight: 700; letter-spacing: .19em; text-transform: uppercase; }
    .eyebrow::before { width: 22px; height: 1px; content: ""; background: #c49aeb; }
    h1 { max-width: 500px; margin: 22px 0 18px; font: 500 clamp(42px, 5.4vw, 68px)/1.02 Georgia, "Times New Roman", serif; letter-spacing: -.045em; text-wrap: balance; }
    h1 span { color: #c9a6e7; }
    .intro { max-width: 420px; margin: 0; color: #aaa3b2; font-size: 16px; line-height: 1.7; }
    .visual { position: relative; width: min(410px, 100%); height: 176px; margin-top: 52px; }
    .orbit { position: absolute; inset: 14px 34px; border: 1px solid rgba(196, 154, 235, .16); border-radius: 50%; transform: rotate(-17deg); }
    .orbit::before, .orbit::after { position: absolute; width: 7px; height: 7px; border-radius: 50%; content: ""; background: #d9b2fc; box-shadow: 0 0 18px #bb83ef; }
    .orbit::before { top: 12px; left: 21%; }
    .orbit::after { right: 13%; bottom: 18px; width: 5px; height: 5px; background: #e5c37e; box-shadow: 0 0 16px #e5c37e; }
    .tile { position: absolute; display: grid; place-items: center; border: 1px solid rgba(219, 204, 231, .16); border-radius: 17px; background: linear-gradient(145deg, rgba(37, 30, 45, .95), rgba(19, 16, 24, .9)); box-shadow: 0 18px 46px rgba(0, 0, 0, .32), inset 0 1px rgba(255, 255, 255, .05); }
    .tile-main { top: 31px; left: 35%; width: 104px; height: 104px; border-radius: 28px; color: #d1b1ee; }
    .tile-small { width: 58px; height: 58px; color: #a99bb7; }
    .tile-one { top: 15px; left: 12%; transform: rotate(-9deg); }
    .tile-two { right: 12%; bottom: 6px; transform: rotate(8deg); }
    .spark { position: absolute; width: 3px; height: 3px; border-radius: 50%; background: #e8ce9e; box-shadow: 0 0 12px 2px rgba(232, 206, 158, .55); }
    .spark-one { top: 7px; right: 28%; }
    .spark-two { bottom: 20px; left: 19%; }
    .login { width: 100%; max-width: 424px; justify-self: end; padding: 38px; border: 1px solid rgba(204, 179, 223, .16); border-radius: 24px; background: linear-gradient(145deg, rgba(27, 22, 33, .95), rgba(17, 14, 21, .96)); box-shadow: 0 32px 100px rgba(0, 0, 0, .4), inset 0 1px rgba(255, 255, 255, .055); }
    .login-kicker { color: #b5a8bf; font-size: 12px; font-weight: 650; letter-spacing: .12em; text-transform: uppercase; }
    h2 { margin: 12px 0 10px; font: 500 34px/1.15 Georgia, "Times New Roman", serif; letter-spacing: -.025em; }
    .login-copy { margin: 0; color: #a69eae; font-size: 14px; line-height: 1.65; }
    .notice { margin: 22px 0 0; padding: 12px 14px; border: 1px solid rgba(234, 179, 112, .28); border-radius: 12px; background: rgba(147, 91, 43, .12); color: #f0d2a6; font-size: 13px; line-height: 1.5; }
    .google-button { display: flex; min-height: 54px; align-items: center; justify-content: center; gap: 12px; margin-top: 30px; padding: 0 20px; border: 1px solid rgba(219, 190, 242, .36); border-radius: 13px; background: linear-gradient(105deg, #d4b8ee, #e4c98e); color: #18121d; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 8px 28px rgba(176, 131, 211, .14); transition: box-shadow 180ms ease, transform 180ms ease, filter 180ms ease; }
    .google-button:hover { filter: brightness(1.06); box-shadow: 0 12px 34px rgba(176, 131, 211, .24); transform: translateY(-1px); }
    .google-button:active { transform: scale(.985); }
    .google-button:focus-visible { outline: 3px solid #e8ce9e; outline-offset: 4px; }
    .divider { display: flex; align-items: center; gap: 12px; margin: 26px 0 17px; color: #716a79; font-size: 11px; letter-spacing: .13em; text-transform: uppercase; }
    .divider::before, .divider::after { height: 1px; flex: 1; content: ""; background: rgba(219, 204, 231, .12); }
    .access-note { display: flex; align-items: flex-start; gap: 10px; color: #9c94a5; font-size: 13px; line-height: 1.6; }
    .access-note svg { flex: 0 0 auto; margin-top: 2px; color: #c7a5e3; }
    footer { margin-top: 32px; color: #77707f; font-size: 11px; letter-spacing: .04em; text-align: center; }
    @media (max-width: 820px) {
      .shell { width: min(560px, calc(100% - 40px)); min-height: auto; grid-template-columns: 1fr; gap: 28px; padding: 32px 0 42px; }
      .brand { margin-bottom: 42px; }
      .story { max-width: none; }
      h1 { max-width: 440px; font-size: clamp(42px, 9vw, 60px); }
      .intro { max-width: 440px; }
      .visual { display: none; }
      .login { max-width: none; justify-self: stretch; padding: clamp(24px, 6vw, 36px); }
    }
    @media (max-width: 420px) {
      .shell { width: calc(100% - 32px); padding-top: 24px; }
      .brand { margin-bottom: 34px; }
      .login { border-radius: 19px; }
      footer { margin-top: 24px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="story" aria-labelledby="page-title">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">
          <svg width="25" height="25" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="12" stroke="url(#brand-gradient)" stroke-width="1.6"/><path d="m9 23 6.7-12.7 3.2 3.2L9 23Z" fill="url(#brand-gradient)"/><path d="m15.7 10.3 7.3-1.8-3.9 7-3.4-5.2Z" fill="#ead3a0"/><defs><linearGradient id="brand-gradient" x1="5" y1="6" x2="27" y2="25" gradientUnits="userSpaceOnUse"><stop stop-color="#d2a9f0"/><stop offset="1" stop-color="#e5c58d"/></linearGradient></defs></svg>
        </span>
        <span><span class="brand-name">R2 Explorer</span><span class="brand-caption">Cloudflare object storage</span></span>
      </div>
      <p class="eyebrow">Your files, in focus</p>
      <h1 id="page-title">A quieter way to explore <span>your storage.</span></h1>
      <p class="intro">One clear workspace for your Cloudflare R2 buckets. Pick up where you left off and keep every object within reach.</p>
      <div class="visual" aria-hidden="true">
        <span class="orbit"></span><span class="spark spark-one"></span><span class="spark spark-two"></span>
        <span class="tile tile-small tile-one"><svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" stroke="currentColor" stroke-width="1.3"/><path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12.2V20" stroke="currentColor" stroke-width="1.3"/></svg></span>
        <span class="tile tile-main"><svg width="48" height="48" viewBox="0 0 48 48" fill="none"><path d="M7 14a3 3 0 0 1 3-3h10l4 4h14a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V14Z" stroke="currentColor" stroke-width="1.5"/><path d="M8 20h32" stroke="currentColor" stroke-width="1.5"/><path d="M17 27h14M17 32h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>
        <span class="tile tile-small tile-two"><svg width="25" height="25" viewBox="0 0 24 24" fill="none"><path d="M5 5h14v14H5z" stroke="currentColor" stroke-width="1.3"/><path d="M8 9h8M8 12h8M8 15h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>
      </div>
    </section>
    <section class="login" aria-labelledby="login-title">
      <p class="login-kicker">Private workspace</p>
      <h2 id="login-title">Welcome back.</h2>
      <p class="login-copy">Continue with the Google account approved for this Explorer workspace.</p>
      ${notice}
      <a class="google-button" href="/auth/google/start">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 48 48"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5h6.6c3.9-3.6 6.1-8.8 6.1-14.9Z"/><path fill="#34A853" d="M24 44c5.5 0 10.1-1.8 13.5-4.8l-6.6-5c-1.8 1.2-4.1 2-6.9 2-5.3 0-9.8-3.6-11.4-8.4H5.8v5.1A20 20 0 0 0 24 44Z"/><path fill="#FBBC05" d="M12.6 27.8a12 12 0 0 1 0-7.6v-5.1H5.8a20 20 0 0 0 0 17.8l6.8-5.1Z"/><path fill="#EA4335" d="M24 11.8c3 0 5.7 1 7.8 3.1l5.8-5.8C34.1 5.8 29.5 4 24 4A20 20 0 0 0 5.8 15.1l6.8 5.1c1.6-4.8 6.1-8.4 11.4-8.4Z"/></svg>
        Continue with Google
      </a>
      <div class="divider">Secure access</div>
      <p class="access-note"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20" fill="none"><path d="M5.5 8V6a4.5 4.5 0 1 1 9 0v2M4 8h12v9H4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg><span>Sign-in is limited to approved accounts. Your private buckets stay private.</span></p>
      <footer>R2 Explorer <span aria-hidden="true">·</span> Secure sign-in</footer>
    </section>
  </main>
</body>
</html>`;
}

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
		if (c.req.query("error") === "access_denied")
			return c.html(
				loginPage(
					"Sign-in was cancelled. You can try again whenever you're ready.",
				),
				401,
			);
		const code = c.req.query("code");
		if (
			!flow ||
			typeof flow.verifier !== "string" ||
			typeof flow.nonce !== "string" ||
			flow.state !== c.req.query("state") ||
			!code
		)
			return c.html(
				loginPage("That sign-in link expired. Start again to continue."),
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
			if (!response.ok)
				return c.html(
					loginPage("Google couldn't complete sign-in. Please try again."),
					401,
				);
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
				return c.html(
					loginPage("This Google account isn't approved for this workspace."),
					403,
				);
			await issue(
				sessionCookie,
				{ sub: payload.sub, email: payload.email.toLowerCase() },
				86400,
			);
			return c.redirect("/");
		} catch {
			return c.html(
				loginPage("Google sign-in couldn't be verified. Please try again."),
				401,
			);
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
		const signin = c.req.query("signin");
		const notice =
			signin === "cancelled"
				? "Sign-in was cancelled. You can try again whenever you're ready."
				: signin === "failed"
					? "Sign-in didn't complete. Please try again."
					: undefined;
		return c.html(loginPage(notice), 401);
	}
	c.set("authentication_type", "google");
	c.set("authentication_username", session.email);
	await next();
}
