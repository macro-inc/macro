import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);
export default defineConfig({
	root: path.join(root, "packages/lexical-conformance"),
	resolve: {
		alias: [
			{
				find: /^loro-crdt$/,
				replacement: path.join(root, "node_modules/loro-crdt/nodejs/index.js"),
			},
			{
				find: /^@loro-mirror\/core$/,
				replacement: path.join(root, "packages/loro-mirror/src/index.ts"),
			},
			{
				find: /^@macro-inc\/lexical-core$/,
				replacement: path.join(
					root,
					"packages/lexical-conformance/diff/collab/core-exports.ts",
				),
			},
			...[
				"lexical",
				"@lexical/headless",
				"@lexical/rich-text",
				"@lexical/utils",
				"@lexical/list",
				"@lexical/mark",
			].map((name) => ({
				find: new RegExp(`^${name}$`),
				replacement: path.join(
					root,
					"node_modules",
					name,
					"dist",
					readdirSync(path.join(root, "node_modules", name, "dist")).find(
						(file) => file.endsWith(".prod.mjs"),
					)!,
				),
			})),
		],
		dedupe: ["lexical"],
	},
	test: {
		env: { NODE_ENV: "production" },
		server: { deps: { inline: [/lexical/] } },
		setupFiles: [path.join(root, "packages/lexical-conformance/diff/setup.ts")],
		include: ["diff/collab/**/*.test.ts"],
		environment: "jsdom",
		maxWorkers: 1,
		hookTimeout: 300000,
		testTimeout: 300000,
	},
});
