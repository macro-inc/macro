import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "observability",
		environment: "jsdom",
		include: ["src/**/*.test.ts"],
	},
});
