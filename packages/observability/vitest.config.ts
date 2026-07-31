import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			// Workerd-only module pulled in at module scope by
			// @microlabs/otel-cf-workers; stub it so worker.ts loads under Node.
			"cloudflare:workers": fileURLToPath(
				new URL("./test/cloudflare-workers-stub.ts", import.meta.url),
			),
		},
	},
	test: {
		name: "observability",
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
		server: {
			deps: {
				// Externalized deps resolve with Node's loader, which can't
				// handle `cloudflare:workers`; inline so the alias applies.
				inline: ["@microlabs/otel-cf-workers"],
			},
		},
	},
});
