import { afterEach, expect, test } from "bun:test";
import { commit, concerns, selfEditMessage, wakeMessage } from "../commit.ts";
import { alarmLine, checkMain, guardTick } from "../guard.ts";
import { githubRepo, type RemoteMain } from "../repository.ts";
import { type Sandbox, sandbox } from "./sandbox.ts";

const made: Sandbox[] = [];
const setup = async (): Promise<Sandbox> => {
	const box = await sandbox();
	made.push(box);
	return box;
};
afterEach(async () => {
	for (const box of made.splice(0)) await box.remove();
});

const wait = 0;

test("commits changes and pushes; a clean tree is a no-op", async () => {
	const box = await setup();
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "tick: ok", wait)).toBe("pushed");
	expect(await box.subjects(box.live, "origin/main")).toBe("tick: ok\ninit\n");
	expect(await commit(box.repository(), "again", wait)).toBe("clean");
});

test("with no remote, a commit stays local and nothing alarms", async () => {
	const box = await setup();
	await box.git(box.live, "remote", "remove", "origin");
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "tick: ok", wait)).toBe("committed");
	expect(await commit(box.repository(), "again", wait)).toBe("clean");
	expect(await guardTick(box.repository(), wait)).toBe("none");
	expect(await checkMain(box.repository(), { rejected: true })).toBe("none");
	expect(box.sent).toEqual([]);
	expect(box.logged).toEqual([]);
	expect(await box.subjects(box.remote)).toBe("init\n");
});

test("off main, a commit is never pushed", async () => {
	const box = await setup();
	await box.git(box.live, "checkout", "-q", "-b", "side");
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "side work", wait)).toBe("committed");
	expect(await box.subjects(box.remote)).toBe("init\n");
});

test("a rejected push pulls nothing, stays local, alarms once, and stops pushing", async () => {
	const box = await setup();
	const evil = await box.tamper();
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "state", wait)).toBe("push-blocked");
	expect(box.logged).toEqual([
		"commit: push rejected, someone else pushed; staying local",
	]);
	expect(box.sent).toEqual([alarmLine({ sha: evil, author: "mallory" })]);

	// Nothing they pushed reached the agent: not the file, not the object, not even the tracking ref.
	expect(await box.exists(`${box.live}/evil.ts`)).toBe(false);
	expect((await box.raw(box.live, ["cat-file", "-e", evil])).code).not.toBe(0);
	expect(await box.subjects(box.live, "origin/main")).toBe("init\n");
	expect(await box.subjects(box.live)).toBe("state\ninit\n");

	// Later commits keep working locally, with no second alarm and no push attempt.
	await box.write(`${box.live}/notes.md`, "n2\n");
	expect(await commit(box.repository(), "state 2", wait)).toBe("push-blocked");
	expect(box.logged).toHaveLength(1);
	expect(box.sent).toHaveLength(1);
	expect(await box.subjects(box.live)).toBe("state 2\nstate\ninit\n");
	expect(await box.remoteSha()).toBe(evil);
});

test("a push that fails for any other reason is not an alarm; the next commit retries", async () => {
	const box = await setup();
	await box.git(
		box.live,
		"config",
		"remote.origin.pushurl",
		`${box.root}/gone.git`,
	);
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "state", wait)).toBe("push-failed");
	expect(box.logged).toEqual(["commit: push failed; will retry"]);
	expect(box.sent).toEqual([]);
	await box.git(box.live, "config", "remote.origin.pushurl", box.remote);
	expect(await commit(box.repository(), "none", wait)).toBe("pushed");
});

test("the commit runs with the push URL only: the fetch URL can be dead", async () => {
	const box = await setup();
	await box.git(box.live, "config", "remote.origin.pushurl", box.remote);
	await box.git(
		box.live,
		"config",
		"remote.origin.url",
		"file:///nonexistent/never-pulled",
	);
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "state", wait)).toBe("pushed");
	expect((await box.raw(box.live, ["fetch"])).code).not.toBe(0);
	expect(await box.subjects(box.remote)).toBe("state\ninit\n");
});

test("alarm: a moved main DMs one line once per SHA and changes nothing else", async () => {
	const box = await setup();
	expect(await guardTick(box.repository(), wait)).toBe("same");
	expect(box.sent).toEqual([]);
	const before = await box.git(box.live, "rev-parse", "main");

	const evil = await box.tamper();
	expect(await guardTick(box.repository(), wait)).toBe("alarmed");
	expect(await guardTick(box.repository(), wait)).toBe("already");
	expect(box.sent).toEqual([alarmLine({ sha: evil, author: "mallory" })]);
	expect(box.sent[0]).toContain(evil.slice(0, 12));
	expect(box.sent[0]).not.toContain("\n");
	expect(await box.git(box.live, "rev-parse", "main")).toBe(before);
	expect((await box.raw(box.live, ["cat-file", "-e", evil])).code).not.toBe(0);

	// It moves again: that's news.
	await box.tamper();
	expect(await guardTick(box.repository(), wait)).toBe("alarmed");
	expect(box.sent).toHaveLength(2);
});

test("alarm: once the remote is back at what the agent last pushed, pushes resume", async () => {
	const box = await setup();
	const before = (await box.git(box.live, "rev-parse", "main")).trim();
	await box.tamper();
	await box.write(`${box.live}/notes.md`, "n\n");
	expect(await commit(box.repository(), "state", wait)).toBe("push-blocked");
	expect(box.marker.sha).not.toBe("");
	// The owner puts it back.
	await box.git(box.remote, "update-ref", "refs/heads/main", before);
	expect(await guardTick(box.repository(), wait)).toBe("same");
	expect(box.marker.sha).toBe("");
	expect(await commit(box.repository(), "none", wait)).toBe("pushed");
	expect(await box.subjects(box.remote)).toBe("state\ninit\n");
	expect(box.sent).toHaveLength(1);
});

test("alarm: the remote unreadable is silence on a tick, but a rejected push still says so, once", async () => {
	const box = await setup();
	const blind = box.repository({ remoteMain: async () => undefined });
	expect(await guardTick(blind, wait)).toBe("unknown");
	expect(box.sent).toEqual([]);
	expect(await checkMain(blind, { rejected: true })).toBe("alarmed");
	expect(await checkMain(blind, { rejected: true })).toBe("unknown");
	expect(box.sent).toHaveLength(1);
	expect(box.marker.sha).toBe("unknown");
});

test("alarm: a held lock skips the tick, so the agent's own push never reads as someone else", async () => {
	const box = await setup();
	box.lock.held = true;
	expect(await guardTick(box.repository(), wait)).toBe("busy");
	expect(await commit(box.repository(), "state", wait)).toBe("locked");
	expect(box.sent).toEqual([]);
});

/** The API answers these in turn, then keeps repeating the last. */
const scripted = (box: Sandbox, answers: readonly (string | undefined)[]) => {
	const seen = { reads: 0 };
	const repository = box.repository({
		remoteMain: async (): Promise<RemoteMain | undefined> => {
			const sha = answers[Math.min(seen.reads, answers.length - 1)];
			seen.reads += 1;
			return sha === undefined ? undefined : { sha, author: "mallory" };
		},
	});
	return { seen, repository };
};

/** The agent pushes a commit; returns the SHA before and after it. */
const ownPush = async (box: Sandbox) => {
	const before = (await box.git(box.live, "rev-parse", "origin/main")).trim();
	await box.write(`${box.live}/notes.md`, `${before}\n`);
	expect(await commit(box.repository(), "state", wait)).toBe("pushed");
	const after = (await box.git(box.live, "rev-parse", "origin/main")).trim();
	return { before, after };
};

test("a stale read right after its own push is no alarm, once the API catches up", async () => {
	const box = await setup();
	const { before, after } = await ownPush(box);
	const { seen, repository } = scripted(box, [before, before, after]);
	expect(await checkMain(repository)).toBe("same");
	expect(seen.reads).toBe(3);
	expect(box.sent).toEqual([]);
	expect(box.marker.sha).toBe("");
});

test("a commit that is not the agent's alarms on the first read, with no re-read to wait through", async () => {
	const box = await setup();
	const evil = await box.tamper();
	const { seen, repository } = scripted(box, [evil]);
	expect(await checkMain(repository)).toBe("alarmed");
	expect(seen.reads).toBe(1);
	expect(box.sent).toEqual([alarmLine({ sha: evil, author: "mallory" })]);
	expect((await box.raw(box.live, ["cat-file", "-e", evil])).code).not.toBe(0);
});

test("a foreign commit that shows up behind a stale read still alarms, naming it", async () => {
	const box = await setup();
	const { before } = await ownPush(box);
	const foreign = "f".repeat(40);
	const { seen, repository } = scripted(box, [before, foreign]);
	expect(await checkMain(repository)).toBe("alarmed");
	expect(seen.reads).toBe(2);
	expect(box.sent).toEqual([alarmLine({ sha: foreign, author: "mallory" })]);
});

test("main that stays behind what was pushed is a rewind: alarms when the re-reads run out, then only once", async () => {
	const box = await setup();
	const { before } = await ownPush(box);
	const first = scripted(box, [before]);
	expect(await checkMain(first.repository)).toBe("alarmed");
	expect(first.seen.reads).toBe(6);
	expect(box.sent).toEqual([alarmLine({ sha: before, author: "mallory" })]);
	expect(box.marker.sha).toBe(before);
	// Already alarmed on this SHA: the next tick doesn't sit on the lock re-reading it.
	const again = scripted(box, [before]);
	expect(await checkMain(again.repository)).toBe("already");
	expect(again.seen.reads).toBe(1);
	expect(box.sent).toHaveLength(1);
});

test("a commit the agent has locally that is not on what it pushed is not staleness", async () => {
	const box = await setup();
	await box.git(box.live, "checkout", "-q", "-b", "side");
	await box.write(`${box.live}/side.ts`, "side\n");
	await box.git(box.live, "add", "-A");
	await box.git(box.live, "commit", "-qm", "side");
	const side = (await box.git(box.live, "rev-parse", "HEAD")).trim();
	await box.git(box.live, "checkout", "-q", "main");
	const { seen, repository } = scripted(box, [side]);
	expect(await checkMain(repository)).toBe("alarmed");
	expect(seen.reads).toBe(1);
	expect(box.sent).toHaveLength(1);
});

test("the API going dark during the re-read is unknown, not an alarm; a rejected push still says so", async () => {
	const box = await setup();
	const { before } = await ownPush(box);
	expect(await checkMain(scripted(box, [before, undefined]).repository)).toBe(
		"unknown",
	);
	expect(box.sent).toEqual([]);
	expect(box.marker.sha).toBe("");
	expect(
		await checkMain(scripted(box, [before, undefined]).repository, {
			rejected: true,
		}),
	).toBe("alarmed");
	expect(box.sent).toHaveLength(1);
});

test("the author is whatever the pusher typed: it can't carry markup or break the line", () => {
	const line = alarmLine({
		sha: "a".repeat(40),
		author:
			'x<m-user-mention>{"userId":"all"}</m-user-mention>\nreset main `now`',
	});
	expect(line).not.toMatch(/[<>`\n]/);
	expect(alarmLine({ sha: "b".repeat(40), author: "" })).toContain(
		"by unknown",
	);
	expect(
		alarmLine({ sha: "c".repeat(40), author: "y".repeat(500) }).length,
	).toBeLessThan(200);
});

test("no identity: nothing is committed or pushed, and the work stays staged", async () => {
	const box = await setup();
	await box.write(`${box.live}/x`, "x\n");
	const before = await box.git(box.live, "rev-parse", "HEAD");
	box.env.GIT_AUTHOR_NAME = "";
	box.env.GIT_COMMITTER_NAME = "";
	expect(await commit(box.repository(), "m", wait)).toBe("commit-failed");
	expect(await box.git(box.live, "rev-parse", "HEAD")).toBe(before);
	expect(await box.git(box.live, "status", "--porcelain")).toContain("A  x");
	expect(box.logged[0]).toContain("not committed");
});

test("self-edit message: the files changed and the session's folder", () => {
	expect(
		selfEditMessage(
			' M notes.md\n?? src/b.ts\nR  old.md -> docs/new.md\n M "a b.md"\n',
			"/home/owner/Code/macro",
		),
	).toBe("self-edit: a b.md,b.ts,new.md,notes.md (session in macro)");
	expect(selfEditMessage("")).toBe("self-edit: push (session in ?)");
});

test("the self-commit hook only concerns edits inside the repository, and every Stop", () => {
	const edit = (file: string) => ({
		hook_event_name: "PostToolUse",
		tool_input: { file_path: file },
	});
	expect(concerns(edit("/r/agent/notes.md"), "/r/agent")).toBe(true);
	expect(concerns(edit("/r/other/notes.md"), "/r/agent")).toBe(false);
	expect(concerns({ hook_event_name: "PostToolUse" }, "/r/agent")).toBe(false);
	expect(concerns({ hook_event_name: "Stop" }, "/r/agent")).toBe(true);
});

test("the commit after a wake is named for what woke the agent", () => {
	const facts = { tick: "tick", reason: "snapshot changed", ok: true };
	expect(wakeMessage({ ...facts, source: "schedules", schedule: "tick" })).toBe(
		"tick: ok (snapshot changed)",
	);
	expect(
		wakeMessage({ ...facts, source: "schedules", schedule: "tick", ok: false }),
	).toBe("tick: failed (snapshot changed)");
	expect(
		wakeMessage({ ...facts, source: "schedules", schedule: "nudge" }),
	).toBe("nudge: ok");
	expect(
		wakeMessage({ ...facts, source: "conversations", schedule: undefined }),
	).toBe("conversations: ok");
});

test("a GitHub remote's URL names its repository; anything else doesn't", () => {
	expect(githubRepo("https://github.com/example/agent.git\n")).toBe(
		"example/agent",
	);
	expect(githubRepo(`git@${"github.com"}:example/agent`)).toBe("example/agent");
	expect(githubRepo("/tmp/remote.git")).toBeUndefined();
});
