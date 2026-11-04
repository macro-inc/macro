import { afterEach, beforeEach, expect, test, vi } from "vitest";

const { listSecrets } = vi.hoisted(() => ({ listSecrets: vi.fn() }));
vi.mock("node:child_process", () => ({ execFileSync: listSecrets }));
const originalArguments = process.argv;
beforeEach(() => {
	vi.resetModules();
	process.argv = ["node", "check-deploy-secrets.mjs", "prod"];
	vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
	process.argv = originalArguments;
	vi.restoreAllMocks();
});

test("blocks deployment when commenter validation has no credential", async () => {
	listSecrets.mockReturnValue(
		JSON.stringify([{ name: "SYNC_SERVICE_KEY_PROD" }]),
	);
	await expect(import("../scripts/check-deploy-secrets.mjs")).rejects.toThrow(
		"Missing LEXICAL_SERVICE_AUTH_KEY",
	);
});

test("accepts the required binding without reading secret values", async () => {
	listSecrets.mockReturnValue(
		JSON.stringify([{ name: "LEXICAL_SERVICE_AUTH_KEY", type: "secret_text" }]),
	);
	await import("../scripts/check-deploy-secrets.mjs");
	expect(listSecrets).toHaveBeenLastCalledWith(
		"npx",
		["wrangler", "secret", "list", "--env", "prod"],
		{ encoding: "utf8" },
	);
});

test("fails closed if Cloudflare cannot list the bindings", async () => {
	listSecrets.mockImplementation(() => {
		throw new Error("List unavailable");
	});
	await expect(import("../scripts/check-deploy-secrets.mjs")).rejects.toThrow(
		"List unavailable",
	);
});
