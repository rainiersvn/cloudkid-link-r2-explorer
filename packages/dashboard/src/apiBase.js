// Devtest builds are served from GitHub Pages, where there is no co-hosted
// R2-Explorer Worker behind window.location.origin. Those builds call the
// production explorer instead. Requests to it must carry the Cloudflare
// Access (Zero Trust) cookie, hence withCredentials on the axios instance.
export const DEVTEST_API_SERVER = "https://explorer.cloudkid.link";

export function isDevtestHost(hostname) {
	return typeof hostname === "string" && hostname.endsWith(".github.io");
}

// The `env` param is only for tests. In app code it must stay unset: Vite
// replaces dotted `process.env.X` accesses at build time, but a bare
// `process.env` object reference crashes in the browser.
export function resolveServerUrl({ hostname, origin, env }) {
	const nodeEnv = env ? env.NODE_ENV : process.env.NODE_ENV;
	if (nodeEnv === "development") {
		const devUrl = env
			? env.VUE_APP_SERVER_URL
			: process.env.VUE_APP_SERVER_URL;
		return devUrl || "http://localhost:8787";
	}
	if (isDevtestHost(hostname)) {
		return DEVTEST_API_SERVER;
	}
	return origin;
}
