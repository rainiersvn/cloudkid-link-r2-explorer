/*
 * Configuration for the dashboard SPA.
 * https://v2.quasar.dev/quasar-cli-vite/quasar-config-file
 *
 * Trimmed during the @quasar/app-vite v1 -> v2 migration: the ssr, pwa, cordova,
 * capacitor, electron and bex blocks were scaffolding for build modes this app
 * has never used, and several of them changed shape in v2. `quasar build` here
 * only ever produces an SPA.
 */

import { defineConfig } from "#q-app/wrappers";
import dotenv from "dotenv";

export default defineConfig(() => ({
	// https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
	preFetch: true,

	// app boot file (/src/boot)
	// --> boot files are part of "main.js"
	// https://v2.quasar.dev/quasar-cli-vite/boot-files
	boot: ["axios", "auth", "bus"],

	// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#css
	css: ["app.scss"],

	// https://github.com/quasarframework/quasar/tree/dev/extras
	extras: ["roboto-font", "material-icons"],

	// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#build
	build: {
		env: dotenv.config().parsed,

		// No explicit `target`. v1 pinned es2019/edge88/firefox78/chrome87/
		// safari13.1, which is why a <style> block that shipped raw SCSS went
		// unnoticed for so long -- every browser that actually loads this app
		// supports native CSS nesting and applied the rules anyway. v2's
		// defaults track browsers that are still supported upstream.

		vueRouterMode: "history", // available values: 'hash', 'history'

		publicPath: process.env.PUBLIC_PATH || "/",
	},

	// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#devserver
	devServer: {
		open: true, // opens browser window automatically
	},

	// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#framework
	framework: {
		config: {
			dark: true,
		},

		// Quasar plugins
		plugins: ["Notify", "Dialog"],
	},

	// https://v2.quasar.dev/options/animations
	animations: [],
}));
