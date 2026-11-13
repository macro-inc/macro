import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	fitTrace,
	redactor,
	sessionHead,
	type Span,
	traceBytes,
	type WakeTrace,
	wakeTrace,
} from "../index.ts";

const fixtures = join(import.meta.dir, "fixtures");
const lines = async (name: string): Promise<readonly unknown[]> =>
	(await Bun.file(join(fixtures, name)).text())
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line): unknown => JSON.parse(line));

const redact = redactor(["fake-deploy-key-123456"]);

describe("wakeTrace", () => {
	test("reads a Claude Code transcript, redacted", async () => {
		const transcript = await lines("claude.jsonl");
		expect(sessionHead(transcript)?.source).toBe("claude");
		expect(wakeTrace({ lines: transcript, live: true, redact })).toEqual({
			v: 1,
			source: "claude",
			sessionId: "11111111-2222-4333-8444-555555555555",
			startedAt: "2026-11-11T09:00:00.000Z",
			endedAt: "2026-11-11T09:00:08.000Z",
			live: true,
			model: "claude-opus-5-5",
			title: "Fix failing test",
			costUsd: 0.42,
			spans: [
				{
					kind: "user",
					at: "2026-11-11T09:00:00.000Z",
					text: "Fix the failing test. The deploy key is [secret].",
				},
				{
					kind: "user",
					at: "2026-11-11T09:00:00.500Z",
					text: "Remember the style guide.\nBe brief.",
				},
				{
					kind: "turn",
					index: 0,
					at: "2026-11-11T09:00:02.000Z",
					end: "2026-11-11T09:00:03.000Z",
					model: "claude-opus-5-5",
					text: "Running the tests.",
					thinking: "Look at the test first.",
					tokens: { input: 100, output: 20, cacheRead: 5000, cacheWrite: 300 },
				},
				{
					kind: "tool",
					id: "toolu_1",
					turn: 0,
					at: "2026-11-11T09:00:03.000Z",
					end: "2026-11-11T09:00:05.000Z",
					name: "Bash",
					input: { command: "bun test", token: "[secret]" },
					result: "1 fail\nAuthorization: Bearer [secret]",
					error: true,
				},
				{
					kind: "turn",
					index: 1,
					at: "2026-11-11T09:00:07.000Z",
					end: "2026-11-11T09:00:07.000Z",
					model: "claude-opus-5-5",
					text: "",
					thinking: "",
					tokens: { input: 50, output: 10, cacheRead: 0, cacheWrite: 0 },
				},
				{
					kind: "tool",
					id: "toolu_2",
					turn: 1,
					at: "2026-11-11T09:00:07.000Z",
					name: "Read",
					input: { file_path: "/work/example/a.test.ts" },
					error: false,
				},
			],
		});
	});

	test("reads a Codex rollout, leaving out the instructions it hands over as user messages", async () => {
		const transcript = await lines("codex.jsonl");
		expect(sessionHead(transcript)?.source).toBe("codex");
		expect(wakeTrace({ lines: transcript, live: false, redact })).toEqual({
			v: 1,
			source: "codex",
			sessionId: "019a0000-0000-7000-8000-000000000001",
			startedAt: "2026-11-11T10:00:00.000Z",
			endedAt: "2026-11-11T10:00:05.000Z",
			live: false,
			model: "gpt-6-sol",
			spans: [
				{
					kind: "user",
					at: "2026-11-11T10:00:00.400Z",
					text: "List the files.",
				},
				{
					kind: "turn",
					index: 0,
					at: "2026-11-11T10:00:02.000Z",
					end: "2026-11-11T10:00:04.000Z",
					model: "gpt-6-sol",
					text: "",
					thinking: "",
					tokens: { input: 900, output: 40, cacheRead: 800, cacheWrite: 0 },
				},
				{
					kind: "tool",
					id: "call_1",
					turn: 0,
					at: "2026-11-11T10:00:02.000Z",
					end: "2026-11-11T10:00:03.000Z",
					name: "exec_command",
					input: '{"cmd":"ls"}',
					result: "a.ts\nb.ts",
					error: true,
				},
				{
					kind: "turn",
					index: 1,
					at: "2026-11-11T10:00:05.000Z",
					end: "2026-11-11T10:00:05.000Z",
					model: "gpt-6-sol",
					text: "Two files: a.ts and b.ts.",
					thinking: "Use ls.",
					tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			],
		});
	});

	test("is undefined for lines that are no transcript, or hold no conversation yet", async () => {
		expect(wakeTrace({ lines: [{ hello: 1 }, "x"], live: true, redact })).toBe(
			undefined,
		);
		const [mode] = await lines("claude.jsonl");
		expect(wakeTrace({ lines: [mode], live: true, redact })).toBe(undefined);
	});

	test("cuts any one text at 200,000 characters", async () => {
		const [mode, prompt] = await lines("claude.jsonl");
		const long = {
			type: "user",
			timestamp: "2026-11-11T09:00:01.000Z",
			sessionId: "11111111-2222-4333-8444-555555555555",
			message: { role: "user", content: "a".repeat(200_010) },
		};
		const trace = wakeTrace({
			lines: [mode, prompt, long],
			live: true,
			redact,
		});
		const last = trace?.spans.at(-1);
		expect(last?.kind === "user" ? last.text : "").toBe(
			`${"a".repeat(200_000)}\n[… 10 more characters]`,
		);
	});
});

const base: WakeTrace = {
	v: 1,
	source: "claude",
	sessionId: "s",
	startedAt: "2026-11-11T09:00:00.000Z",
	endedAt: "2026-11-11T09:10:00.000Z",
	live: false,
	spans: [],
};
const tool = (index: number, size: number): Span => ({
	kind: "tool",
	id: `t${index}`,
	turn: index,
	at: `2026-11-11T09:00:${String(index % 60).padStart(2, "0")}.000Z`,
	name: "Bash",
	input: { command: "x".repeat(size) },
	result: "r".repeat(size),
	error: false,
});

describe("fitTrace", () => {
	test("returns a trace that fits as it is", () => {
		const trace = { ...base, spans: [tool(0, 10)] };
		expect(fitTrace(trace, 10_000)).toBe(trace);
	});

	test("cuts tool results and thinking before anything else", () => {
		const prompt: Span = {
			kind: "user",
			at: base.startedAt,
			text: "p".repeat(5_000),
		};
		const trace = {
			...base,
			spans: [prompt, { ...tool(1, 10), result: "r".repeat(50_000) }],
		};
		const fitted = fitTrace(trace, 30_000);
		expect(traceBytes(fitted)).toBeLessThanOrEqual(30_000);
		expect(fitted.spans[0]).toEqual(prompt);
		const cut = fitted.spans[1];
		expect(cut?.kind === "tool" ? cut.result : "").toBe(
			`${"r".repeat(20_000)}\n[… 30000 more characters]`,
		);
	});

	test("drops the oldest spans, keeping the prompt, when cutting texts is not enough", () => {
		const prompt: Span = { kind: "user", at: base.startedAt, text: "do it" };
		const spans = [
			prompt,
			...Array.from({ length: 2_000 }, (_, i) => tool(i, 5_000)),
		];
		const limit = 100_000;
		const fitted = fitTrace({ ...base, spans }, limit);
		expect(traceBytes(fitted)).toBeLessThanOrEqual(limit);
		expect(fitted.spans[0]).toEqual(prompt);
		const marker = fitted.spans[1];
		expect(marker?.kind === "user" ? marker.text : "").toMatch(
			/^\[\d+ earlier spans cut to fit the upload limit\]$/,
		);
		expect(fitted.spans.at(-1)).toMatchObject({ id: "t1999" });
	});

	test("leaves no spans when not even one fits", () => {
		const limit = traceBytes(base) + 5;
		const fitted = fitTrace({ ...base, spans: [tool(0, 1_000)] }, limit);
		expect(fitted.spans).toEqual([]);
		expect(traceBytes(fitted)).toBeLessThanOrEqual(limit);
	});
});
