import { expect, test } from "bun:test";
import type { WakeContext } from "@muppet/lib/core/agent";
import { memoryCredentials } from "@muppet/lib/utilities/credentials";
import type { Clock } from "@muppet/lib/utilities/time";
import type { Disk } from "../../context/disk.ts";
import type { ClaudeAgent } from "../claude.ts";
import { type Fetch, recordedAgent, trigger } from "../telemetry.ts";

const sessionId = "11111111-2222-4333-8444-555555555555";
const transcriptLine = {
	type: "user",
	timestamp: "2026-11-11T09:00:00.000Z",
	sessionId,
	message: { role: "user", content: "deploy with fake-macro-key-123456" },
};

/** A disk holding one Claude Code transcript. */
const disk = (): Pick<Disk, "list" | "read"> => ({
	list: async (directory) =>
		directory === "/home/a/.claude/projects" ? ["-repo"] : [],
	read: async (path) =>
		path === `/home/a/.claude/projects/-repo/${sessionId}.jsonl`
			? `${JSON.stringify(transcriptLine)}\nnot json\n`
			: undefined,
});

const clock = {
	now: () => Temporal.Instant.from("2026-11-11T09:00:00Z"),
	sleep: () => new Promise<void>(() => {}),
} as unknown as Clock;

/** Claude, seen from outside: one session, then done. */
const claude: ClaudeAgent = {
	wake: async (_, observe) => {
		observe?.session({ agent: "claude", id: sessionId, model: "m" });
		observe?.usage({ costUsd: 0.5, turns: 2 });
		return { kind: "done", reply: "ok" };
	},
};

const wake = {
	request: "answer",
	systemPrompt: "charter",
	event: { name: "messages", payload: {} },
	state: {},
} as unknown as WakeContext;

const setup = (answer: (url: string, init: RequestInit) => number) => {
	const calls: { url: string; method: string; body: string; key: string }[] =
		[];
	const fetch: Fetch = async (url, init) => {
		const headers = init.headers as Record<string, string>;
		calls.push({
			url,
			method: init.method ?? "GET",
			body: String(init.body),
			key: headers["x-macro-user-api-key"] ?? "",
		});
		return new Response(null, { status: answer(url, init) });
	};
	const agent = recordedAgent(
		{
			config: {
				harness: "https://harness.test",
				me: "macro|agent@example.com",
				home: "/home/a",
			} as never,
			credentials: memoryCredentials({
				MACRO_API_KEY: "fake-macro-key-123456",
			}),
			clock,
			disk: disk() as Disk,
			join: (...parts) => parts.join("/"),
		},
		claude,
		fetch,
	);
	return { agent, calls };
};

test("records each wake and uploads its redacted trace to the agent's wakes", async () => {
	const { agent, calls } = setup(() => 204);
	expect(await agent.wake(wake)).toEqual({ kind: "done", reply: "ok" });
	const wakes = "https://harness.test/agents/macro%7Cagent%40example.com/wakes";
	const posts = calls.filter(({ method }) => method === "POST");
	const puts = calls.filter(({ method }) => method === "PUT");
	expect(posts.every(({ url }) => url === wakes)).toBe(true);
	expect(puts.length).toBeGreaterThan(0);
	expect(puts.every(({ url }) => /\/wakes\/[^/]+\/trace$/.test(url))).toBe(
		true,
	);
	// The last thing sent is the finished trace.
	const last = calls.at(-1);
	expect(last?.method).toBe("PUT");
	expect((JSON.parse(last?.body ?? "{}") as { live: boolean }).live).toBe(
		false,
	);
	expect(calls.every(({ key }) => key === "fake-macro-key-123456")).toBe(true);
	const phases = calls
		.filter(({ method }) => method === "POST")
		.map(({ body }) => (JSON.parse(body) as { phase: string }).phase);
	expect(phases).toEqual(["start", "session", "end"]);
	for (const { method, body } of calls)
		if (method === "PUT") expect(body).not.toContain("fake-macro-key-123456");
});

test("stops for the run once Macro answers 404, and never fails the wake", async () => {
	const { agent, calls } = setup(() => 404);
	expect(await agent.wake(wake)).toEqual({ kind: "done", reply: "ok" });
	expect(await agent.wake(wake)).toEqual({ kind: "done", reply: "ok" });
	expect(calls).toHaveLength(1);
});

test("a wake's trigger follows its event", () => {
	expect(trigger({ name: "messages", payload: {} }).kind).toBe("message");
	expect(trigger({ name: "schedules", payload: {} }).kind).toBe("schedule");
	expect(trigger({ name: "screen", payload: {} })).toEqual({
		kind: "event",
		source: "screen",
		ids: {},
	});
});
