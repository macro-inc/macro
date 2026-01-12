import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import solidPlugin from "vite-plugin-solid";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
	plugins: [
		tailwindcss(),
		wasm(),
		topLevelAwait(),
		solidPlugin(),
		nodePolyfills({}),
	],
	server: {
		port: 3000,
	},
	build: {
		target: "esnext",
	},
});
