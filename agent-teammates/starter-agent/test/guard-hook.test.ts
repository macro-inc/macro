// bin/guard-hook's fallback, for when `bin/agent guard` can't answer. It is
// run from a copy beside a `bin/agent` that always fails, so the fallback is
// what decides.
import { afterAll, expect, test } from "bun:test";
import { chmod, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const copy = await mkdtemp(join(tmpdir(), "guard-hook-"));
await Bun.spawn(["mkdir", "-p", join(copy, "bin")]).exited;
await copyFile(
	join(root, "bin", "guard-hook"),
	join(copy, "bin", "guard-hook"),
);
await writeFile(join(copy, "bin", "agent"), "#!/bin/sh\nexit 1\n");
await chmod(join(copy, "bin", "agent"), 0o755);
afterAll(() => rm(copy, { recursive: true, force: true }));

const hook = (
	call: object,
	environment: Readonly<Record<string, string>>,
): string => {
	const run = Bun.spawnSync(["bash", join(copy, "bin", "guard-hook")], {
		stdin: Buffer.from(JSON.stringify(call)),
		env: { PATH: process.env.PATH ?? "", ...environment },
	});
	expect(run.exitCode).toBe(0);
	return run.stdout.toString();
};
const bash = (command: string) => ({
	tool_name: "Bash",
	tool_input: { command },
});
const agent = { AGENT_SESSION: "1" };

test("with the guard broken, the agent's session still can't write its identity", () => {
	expect(hook(bash("git config user.name x"), agent)).toContain('"deny"');
	expect(hook(bash("gh auth login"), agent)).toContain('"deny"');
	expect(
		hook(
			{ tool_name: "Edit", tool_input: { file_path: "/r/.git/config" } },
			agent,
		),
	).toContain('"deny"');
});

test("everything else goes through, and the machine user's sessions aren't the agent's", () => {
	expect(hook(bash("git status"), agent)).toBe("");
	expect(hook(bash("git config user.name x"), {})).toBe("");
	expect(hook(bash("gh auth login"), { GIT_AUTHOR_NAME: "" })).toBe("");
});
