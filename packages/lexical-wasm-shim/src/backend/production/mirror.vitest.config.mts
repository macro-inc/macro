import { resolve } from "node:path";
import { defineConfig } from "vitest/config";
const source = process.env.COMPAT_SOURCE_ROOT;
if (!source)
	throw new Error(
		"Set COMPAT_SOURCE_ROOT to the actual production source worktree",
	);
export default defineConfig({
	cacheDir: resolve(process.env.TMPDIR ?? "/tmp", "compat-record-mirror-vite"),
	resolve: {
		alias: [
			{
				find: /^\.\/values$/,
				replacement: resolve(
					source,
					"packages/lexical-wasm-shim/src/backend/production/values.ts",
				),
			},
			{
				find: "@macro-inc/collaboration/session/compatibility.generated",
				replacement: resolve(
					import.meta.dirname,
					"../../../../collaboration/src/session/compatibility.generated.ts",
				),
			},
		],
	},
	test: {
		include: [resolve(import.meta.dirname, "mirror.test.ts")],
		environment: "node",
		maxWorkers: 1,
	},
});
