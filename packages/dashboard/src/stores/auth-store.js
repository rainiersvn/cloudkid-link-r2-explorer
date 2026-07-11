import { api } from "boot/axios";
import { defineStore } from "pinia";
import { isDevtestHost } from "src/apiBase";
import { useMainStore } from "stores/main-store";

const SESSION_KEY = "r2_explorer_session_token";

export const useAuthStore = defineStore("auth", {
	state: () => ({}),
	getters: {
		isAuthenticated: (state) => !!state.user,
		StateUser: (state) => state.user,
	},
	actions: {
		async LogIn(router, form) {
			// Devtest previews (GitHub Pages) have no reachable API backend,
			// so any credentials would fail with a misleading error
			if (isDevtestHost(window.location.hostname)) {
				throw new Error(
					"Sign-in is disabled in the devtest preview. Use the production explorer for real data.",
				);
			}

			const mainStore = useMainStore();
			const token = btoa(`${form.username}:${form.password}`);

			api.defaults.headers.common["Authorization"] = `Basic ${token}`;
			try {
				await mainStore.loadServerConfigs(router, this.q);
			} catch (e) {
				console.log(e);
				delete api.defaults.headers.common["Authorization"];
				throw new Error("Invalid username or password");
			}

			api.defaults.headers.common.Authorization = `Basic ${token}`;

			if (form.remind === true) {
				localStorage.setItem(SESSION_KEY, token);
			} else {
				sessionStorage.setItem(SESSION_KEY, token);
			}
		},
		async CheckLoginInStorage(router, q) {
			let token = sessionStorage.getItem(SESSION_KEY);
			let authed = false;
			if (!token) {
				token = localStorage.getItem(SESSION_KEY);
			}

			if (!token) {
				return false;
			}

			const mainStore = useMainStore();
			api.defaults.headers.common["Authorization"] = `Basic ${token}`;

			authed = await mainStore.loadServerConfigs(router, q, true);
			if (!authed) {
				delete api.defaults.headers.common["Authorization"];
				return false;
			}

			return false;
		},
		async LogOut(router) {
			localStorage.removeItem(SESSION_KEY);
			sessionStorage.removeItem(SESSION_KEY);

			await router.replace({ name: "login" });
		},
	},
});
