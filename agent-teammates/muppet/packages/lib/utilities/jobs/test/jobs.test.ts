import { describe, expect, test } from "bun:test";
import {
	type Exec,
	herdrJobs,
	job,
	ownerLabel,
	type Terminal,
} from "../herdr.ts";
import { memoryJobs } from "../index.ts";

/** Terminals as `hc get --json` describes them, trimmed to what jobs read. */
const live: Terminal = {
	address: "t17d",
	name: "shirts",
	state: "live",
	status: { app: "claude-code", state: "working" },
	reason: null,
	exit_code: null,
	signal: null,
	parent: "t60",
	labels: { [ownerLabel]: "agent", run: "20261110T163144Z" },
};
const exited: Terminal = {
	...live,
	state: "finished",
	status: null,
	reason: "exited",
	exit_code: 7,
};
const killed: Terminal = {
	...exited,
	reason: "killed",
	exit_code: null,
	signal: 1,
};

describe("a terminal as a job", () => {
	test("running, with what the agent is doing, and the owner's label left out", () => {
		expect(job(live)).toEqual({
			name: "shirts",
			labels: { run: "20261110T163144Z" },
			parent: "t60",
			status: { kind: "running", activity: "working" },
		});
	});

	test("an agent's status is a word in a listing", () => {
		expect(job({ ...live, status: "blocked" }).status).toEqual({
			kind: "running",
			activity: "blocked",
		});
	});

	test("a plain program has no activity", () => {
		expect(job({ ...live, status: null }).status).toEqual({ kind: "running" });
	});

	test("finished: how, with its exit code or its signal", () => {
		expect(job(exited).status).toEqual({
			kind: "finished",
			reason: "exited",
			exitCode: 7,
		});
		expect(job(killed).status).toEqual({
			kind: "finished",
			reason: "killed",
			signal: 1,
		});
	});
});

/** A fake hc: answers from a table of terminals by name, and records every call. */
const fakeHc = (terminals: Record<string, Terminal | undefined>) => {
	const calls: string[][] = [];
	const exec: Exec = async (argv) => {
		calls.push([...argv]);
		const [, command, name] = argv;
		// Like hc, a terminal is found by its name or its address.
		const found =
			name === undefined
				? undefined
				: (terminals[name] ??
					Object.values(terminals).find(
						(terminal) => terminal?.address === name,
					));
		const answer = (value: unknown) => ({
			code: 0,
			stdout: JSON.stringify(value),
			stderr: "",
		});
		if (command === "get")
			return found === undefined
				? {
						code: 3,
						stdout: "",
						stderr: JSON.stringify({
							error: { kind: "not_found", message: `no terminal "${name}"` },
						}),
					}
				: answer(found);
		if (command === "ls")
			return answer({
				terminals: Object.values(terminals).flatMap((terminal) =>
					terminal === undefined ? [] : [{ address: terminal.address }],
				),
			});
		return answer({});
	};
	return { exec, calls };
};

describe("herdrJobs", () => {
	test("starts a job with the owner's label, under the default parent, and argv after --", async () => {
		const hc = fakeHc({ shirts: live });
		const jobs = herdrJobs({ owner: "agent", parent: "t60", exec: hc.exec });
		const started = await jobs.start({
			name: "shirts",
			argv: ["claude", "--name", "x"],
			cwd: "/work",
			labels: { run: "20261110T163144Z" },
		});
		expect(started.status.kind).toBe("running");
		expect(hc.calls[0]).toEqual([
			"hc",
			"run",
			"--bg",
			"--no-notify",
			"--name",
			"shirts",
			"--cwd",
			"/work",
			"--label",
			"run=20261110T163144Z",
			"--label",
			`${ownerLabel}=agent`,
			"--parent",
			"t60",
			"--",
			"claude",
			"--name",
			"x",
			"--json",
		]);
	});

	test("a job that doesn't exist is undefined, not an error", async () => {
		const jobs = herdrJobs({ owner: "agent", exec: fakeHc({}).exec });
		expect(await jobs.get("nothing")).toBeUndefined();
	});

	test("never sees or touches a terminal that isn't its owner's", async () => {
		const someoneElses: Terminal = {
			...live,
			address: "t6j",
			name: "other",
			labels: {},
		};
		const hc = fakeHc({ other: someoneElses, shirts: live });
		const jobs = herdrJobs({ owner: "agent", exec: hc.exec });
		expect(await jobs.get("other")).toBeUndefined();
		expect((await jobs.list()).map(({ name }) => name)).toEqual(["shirts"]);
		await expect(jobs.stop("other")).rejects.toThrow("no job named other");
		await expect(jobs.send("other", "hi")).rejects.toThrow();
		expect(hc.calls.some(([, command]) => command === "kill")).toBe(false);
		expect(hc.calls.some(([, command]) => command === "send")).toBe(false);
	});

	test("lists only the owner's jobs: the owner's label is always in the filter", async () => {
		const hc = fakeHc({ shirts: live });
		await herdrJobs({ owner: "agent", exec: hc.exec }).list({ run: "x" });
		expect(hc.calls[0]).toEqual([
			"hc",
			"ls",
			"--all",
			"--label",
			"run=x",
			"--label",
			`${ownerLabel}=agent`,
			"--json",
		]);
	});

	test("stopping a finished job does nothing; stopping a running one kills it", async () => {
		const hc = fakeHc({ done: { ...exited, name: "done" }, shirts: live });
		const jobs = herdrJobs({ owner: "agent", exec: hc.exec });
		await jobs.stop("done");
		await jobs.stop("shirts");
		expect(hc.calls.filter(([, command]) => command === "kill")).toEqual([
			["hc", "kill", "shirts", "--json"],
		]);
	});

	test("only a finished job is forgotten", async () => {
		const hc = fakeHc({ done: { ...exited, name: "done" }, shirts: live });
		const jobs = herdrJobs({ owner: "agent", exec: hc.exec });
		await jobs.forget("shirts");
		await jobs.forget("done");
		expect(hc.calls.filter(([, command]) => command === "rm")).toEqual([
			["hc", "rm", "done", "--json"],
		]);
	});

	test("changes: each change yields the job as it now is; the snapshot and repeats are skipped", async () => {
		const terminals: Record<string, Terminal> = { t17d: live };
		const hc = fakeHc(terminals);
		const jobs = herdrJobs({
			owner: "agent",
			exec: hc.exec,
			follow: async function* () {
				yield JSON.stringify({ channel: null, seq: 1, terminals: [live] });
				yield JSON.stringify({
					jsonrpc: "2.0",
					method: "event",
					params: { terminal: "t17d", type: "status", seq: 2, data: {} },
				});
				// The same job again, unchanged: not yielded. Then it has finished.
				yield JSON.stringify({
					jsonrpc: "2.0",
					method: "event",
					params: { terminal: "t17d", type: "foreground", seq: 3, data: {} },
				});
				terminals.t17d = exited;
				yield JSON.stringify({
					jsonrpc: "2.0",
					method: "event",
					params: { terminal: "t17d", type: "finished", seq: 4, data: {} },
				});
			},
		});
		const changes = jobs.changes()[Symbol.asyncIterator]();
		expect((await changes.next()).value).toMatchObject({
			name: "shirts",
			status: { kind: "running", activity: "working" },
		});
		expect((await changes.next()).value?.status).toEqual({
			kind: "finished",
			reason: "exited",
			exitCode: 7,
		});
	});
});

describe("memoryJobs", () => {
	test("tracks jobs and tells watchers of their changes", async () => {
		const jobs = memoryJobs();
		const changes = jobs.changes({ run: "a" })[Symbol.asyncIterator]();
		await jobs.start({
			name: "other",
			argv: [],
			cwd: "/",
			labels: { run: "b" },
		});
		await jobs.start({
			name: "mine",
			argv: [],
			cwd: "/",
			labels: { run: "a" },
		});
		jobs.act("mine", "working");
		jobs.finish("mine", { reason: "exited", exitCode: 0 });
		expect((await changes.next()).value?.status).toEqual({ kind: "running" });
		expect((await changes.next()).value?.status).toEqual({
			kind: "running",
			activity: "working",
		});
		expect((await changes.next()).value?.status).toEqual({
			kind: "finished",
			reason: "exited",
			exitCode: 0,
		});
		await expect(
			jobs.start({ name: "other", argv: [], cwd: "/" }),
		).rejects.toThrow("already running");
	});
});
