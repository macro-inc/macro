import { expect, test } from "bun:test";
import { noIdentity } from "../../../context/identity.ts";
import { refusal } from "../../guard.ts";
import { ghIdentity, ghIdentityGuard, identityReason } from "../gh-identity.ts";
import { guards } from "../index.ts";

const WITH_TOKEN = { AGENT_SESSION: "1", GH_TOKEN: "agents" };
const bash = (
	command: string,
	environment: Readonly<Record<string, string | undefined>> = noIdentity,
	cwd = "/home/owner/agent",
) => ghIdentity({ tool: "Bash", input: { command }, cwd, environment });

test("without its token, the agent's sessions don't use gh or push", () => {
	for (const command of [
		"gh issue create -t x -b y",
		"gh pr create -t x -b y",
		"gh api repos/x/y/issues",
		"gh repo view",
		"GH_CONFIG_DIR=~/.config/gh gh pr merge 3",
		"git push origin HEAD",
		"git -C /home/owner/agent push",
		"cd /x && git push",
		'x="$(gh issue close 5)"',
		'bash -c "gh issue close 5"',
		"true && git push",
	])
		expect([command, bash(command)]).toEqual([command, identityReason]);
});

test("the reason names the credential to add", () => {
	expect(identityReason).toContain("AGENT_GITHUB_TOKEN");
	expect(identityReason).toContain("setCredential");
});

test("with its token, gh and a push are the agent's own", () => {
	expect(bash("gh pr create -t x -b y", WITH_TOKEN)).toBeUndefined();
	expect(bash("git push origin HEAD", WITH_TOKEN)).toBeUndefined();
	expect(bash("GH_TOKEN=t gh issue create -t x")).toBeUndefined();
	expect(bash("export GH_TOKEN=t; gh issue create -t x")).toBeUndefined();
});

test("other git, and text that only mentions gh or push, pass", () => {
	expect(bash("git status")).toBeUndefined();
	expect(bash("git commit -m 'git push later'")).toBeUndefined();
	expect(bash('echo "gh pr merge 3"')).toBeUndefined();
	expect(
		ghIdentity({ tool: "Edit", input: {}, cwd: "/w", environment: noIdentity }),
	).toBeUndefined();
});

test("the machine user's own sessions are none of the guard's business", () => {
	expect(bash("gh pr create -t x -b y", {})).toBeUndefined();
	expect(bash("git push", {})).toBeUndefined();
});

test("it is one of the guards", () => {
	expect(ghIdentityGuard.name).toBe("gh-identity");
	expect(
		refusal(guards, {
			tool: "Bash",
			input: { command: "git push" },
			cwd: "/w",
			environment: noIdentity,
		}),
	).toBe(`gh-identity: ${identityReason}`);
});
