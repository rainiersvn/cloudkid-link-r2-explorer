import { api } from "boot/axios";
import { defineStore } from "pinia";
import { isDevtestHost, resolveServerUrl } from "src/apiBase";

export const useMainStore = defineStore("main", {
	state: () => ({
		// Config
		apiReadonly: true,
		auth: {},
		config: {},
		version: "",
		showHiddenFiles: false,

		// Frontend data
		buckets: [],
	}),
	getters: {
		serverUrl() {
			return resolveServerUrl({
				hostname: window.location.hostname,
				origin: window.location.origin,
			});
		},
	},
	actions: {
		async loadServerConfigs(router, q, handleError = false) {
			// This is the initial requests to server, that also checks if user needs auth

			try {
				const response = await api.get("/server/config", {
					validateStatus: (status) => status >= 200 && status < 300,
				});

				this.apiReadonly = response.data.config.readonly;
				this.config = response.data.config;
				this.auth = response.data.auth;
				this.version = response.data.version;
				this.showHiddenFiles = response.data.config.showHiddenFiles;
				this.buckets = response.data.buckets;

				const url = new URL(window.location.href);
				// Strip the router base so the check also works when the app is
				// served from a sub-path (e.g. GitHub Pages project sites)
				const base = router.options?.history?.base || "";
				const path = url.pathname.startsWith(base)
					? url.pathname.slice(base.length) || "/"
					: url.pathname;
				if (url.searchParams.get("next")) {
					await router.replace(url.searchParams.get("next"));
				} else if (path === "/" || path === "/auth/login") {
					await router.push({
						name: "files-home",
						params: { bucket: this.buckets[0].name },
					});
				}

				return true;
			} catch (error) {
				console.log(error);
				if (error.response?.status === 302) {
					// Handle cloudflare access login page
					const nextUrl = error.response.headers.Location;
					if (nextUrl) {
						window.location.replace(nextUrl);
					}
				}

				if (handleError) {
					const respText = error.response ? await error.response.data : "";
					if (respText === "Authentication error: Basic Auth required") {
						await router.push({
							name: "login",
							query: { next: router.currentRoute.value.fullPath },
						});
						return;
					}

					// Devtest previews (GitHub Pages) have no reachable API backend,
					// so show the login screen as a static UI preview instead of an
					// unreachable error state
					if (isDevtestHost(window.location.hostname)) {
						q.notify({
							type: "info",
							message:
								"Devtest preview: no API backend is connected. Use the production explorer for real data.",
							timeout: 10000,
						});
						await router.push({ name: "login" });
						return false;
					}

					// Error bodies can be full HTML pages (e.g. Cloudflare Access
					// or GitHub Pages 404s) — never dump those into a toast
					const message =
						typeof respText === "string" &&
						respText.length > 0 &&
						respText.length <= 200 &&
						!respText.includes("<")
							? respText
							: `Unable to load the server config (${error.response?.status || "network error"})`;

					q.notify({
						type: "negative",
						message,
						timeout: 10000, // we will timeout it in 10s
					});
				} else {
					throw error;
				}
			}

			return false;
		},
	},
});
