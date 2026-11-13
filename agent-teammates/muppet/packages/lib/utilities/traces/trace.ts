/**
 * A model session's transcript as a timeline of spans: what was said to it,
 * each model turn, and each tool it called, with what came back. Claude Code
 * transcripts and Codex rollouts are both read, from their parsed JSON Lines.
 * They belong to other programs, so every line is parsed loosely: a field
 * they add or drop costs that field, never the trace.
 */
import { z } from "zod";
import type { Redactor } from "./redact.ts";

/** The version of the trace format, `v` on every trace. */
export const traceVersion = 1;

/** Tokens one model turn used. */
export type Tokens = {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
};

/** One step on a trace's timeline. Instants are ISO 8601. */
export type Span =
	| {
			/** The prompt, or anything said to the session after it: a person typing, a hook's context. */
			readonly kind: "user";
			readonly at: string;
			readonly text: string;
	  }
	| {
			/** One model response. */
			readonly kind: "turn";
			readonly index: number;
			readonly at: string;
			readonly end: string;
			readonly model?: string;
			readonly text: string;
			readonly thinking: string;
			readonly tokens: Tokens;
	  }
	| {
			readonly kind: "tool";
			/** The tool call's id. */
			readonly id: string;
			/** The index of the turn that called it. */
			readonly turn: number;
			readonly at: string;
			/** Absent while it is still running. */
			readonly end?: string;
			readonly name: string;
			readonly input: unknown;
			/** The result as text; absent while it is still running. */
			readonly result?: string;
			readonly error: boolean;
	  };

/** Which agent wrote the transcript. */
export type TraceSource = "claude" | "codex";

/** One wake's model session, as Macro stores it (`PUT /agents/{agent}/wakes/{wake}/trace`). */
export type WakeTrace = {
	readonly v: typeof traceVersion;
	readonly source: TraceSource;
	readonly sessionId: string;
	/** The first transcript line's time. */
	readonly startedAt: string;
	/** The last transcript line's time. */
	readonly endedAt: string;
	/** Whether the session is still being written. */
	readonly live: boolean;
	readonly model?: string;
	/** Claude Code's title for the session. */
	readonly title?: string;
	readonly costUsd?: number;
	readonly spans: readonly Span[];
};

const line = z.looseObject({
	type: z.string(),
	timestamp: z.string().optional(),
	sessionId: z.string().optional(),
	cwd: z.string().optional(),
	message: z.unknown().optional(),
	attachment: z.unknown().optional(),
	totalCostUSD: z.number().optional(),
	aiTitle: z.string().optional(),
	payload: z.unknown().optional(),
});
const block = z.looseObject({
	type: z.string(),
	text: z.string().optional(),
	thinking: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	input: z.unknown().optional(),
	tool_use_id: z.string().optional(),
	content: z.unknown().optional(),
	is_error: z.boolean().optional(),
});
const claudeMessage = z.looseObject({
	id: z.string().optional(),
	model: z.string().optional(),
	content: z.union([z.string(), z.array(z.unknown())]),
	usage: z
		.looseObject({
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
			cache_read_input_tokens: z.number().optional(),
			cache_creation_input_tokens: z.number().optional(),
		})
		.optional(),
});
const codexPayload = z.looseObject({
	type: z.string().optional(),
	id: z.string().optional(),
	cwd: z.string().optional(),
	model: z.string().optional(),
	role: z.string().optional(),
	content: z.unknown().optional(),
	call_id: z.string().optional(),
	name: z.string().optional(),
	input: z.unknown().optional(),
	arguments: z.unknown().optional(),
	output: z.unknown().optional(),
	usage: z.unknown().optional(),
});
const codexUsage = z.looseObject({
	input_tokens: z.number().optional(),
	output_tokens: z.number().optional(),
	cached_input_tokens: z.number().optional(),
});
const output = z.looseObject({
	output: z.unknown().optional(),
	exit_code: z.number().optional(),
	exitCode: z.number().optional(),
});

/** The most characters any one text in a trace keeps. */
export const textLimit = 200_000;

const emptyTokens = (): Tokens => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
});

/** `value` cut to `limit` characters, saying how many were cut. */
export const capText = (value: string, limit: number): string =>
	value.length > limit
		? `${value.slice(0, limit)}\n[… ${value.length - limit} more characters]`
		: value;

const safeText = (redact: Redactor, value: string): string =>
	capText(redact.text(value), textLimit);

const blocks = (value: unknown): readonly z.infer<typeof block>[] => {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item) => {
		const parsed = block.safeParse(item);
		return parsed.success ? [parsed.data] : [];
	});
};
const contentText = (value: unknown): string => {
	if (typeof value === "string") return value;
	return blocks(value)
		.map((item) => (item.type === "image" ? "[image]" : (item.text ?? "")))
		.filter(Boolean)
		.join("\n");
};

/** Whose transcript the lines are, its session id, and when it began. Undefined for lines that are neither Claude Code's nor Codex's. */
export const sessionHead = (
	lines: readonly unknown[],
):
	| {
			readonly id: string;
			readonly started?: string;
			readonly source: TraceSource;
	  }
	| undefined => {
	let firstTimestamp: string | undefined;
	// Claude Code's first lines (mode, permission-mode) carry the session id but no cwd: the first message has both.
	let claudeId: string | undefined;
	for (const raw of lines) {
		const parsed = line.safeParse(raw);
		if (!parsed.success) continue;
		const item = parsed.data;
		firstTimestamp ??= item.timestamp;
		claudeId ??= item.sessionId;
		if (item.sessionId && item.cwd)
			return {
				id: item.sessionId,
				...(firstTimestamp === undefined ? {} : { started: firstTimestamp }),
				source: "claude",
			};
		if (item.type === "session_meta") {
			const payload = codexPayload.safeParse(item.payload);
			if (payload.success && payload.data.id)
				return {
					id: payload.data.id,
					...(firstTimestamp === undefined ? {} : { started: firstTimestamp }),
					source: "codex",
				};
		}
	}
	return claudeId === undefined
		? undefined
		: {
				id: claudeId,
				...(firstTimestamp === undefined ? {} : { started: firstTimestamp }),
				source: "claude",
			};
};

type UserSpan = Extract<Span, { kind: "user" }>;
type ToolDraft = {
	kind: "tool";
	id: string;
	turn: number;
	at: string;
	end?: string;
	name: string;
	input: unknown;
	result?: string;
	error: boolean;
};
type TurnDraft = {
	kind: "turn";
	index: number;
	at: string;
	end: string;
	model?: string;
	text: string[];
	thinking: string[];
	tokens: Tokens;
};
type Draft = {
	spans: (UserSpan | ToolDraft | TurnDraft)[];
	tools: Map<string, ToolDraft>;
	turns: TurnDraft[];
};
const draft = (): Draft => ({ spans: [], tools: new Map(), turns: [] });
const addTurn = (state: Draft, at: string, model?: string): TurnDraft => {
	const turn: TurnDraft = {
		kind: "turn",
		index: state.turns.length,
		at,
		end: at,
		...(model === undefined ? {} : { model }),
		text: [],
		thinking: [],
		tokens: emptyTokens(),
	};
	state.turns.push(turn);
	state.spans.push(turn);
	return turn;
};
const addTool = (
	state: Draft,
	turn: TurnDraft,
	at: string,
	id: string,
	name: string,
	input: unknown,
	redact: Redactor,
): void => {
	const tool: ToolDraft = {
		kind: "tool",
		id,
		turn: turn.index,
		at,
		name: redact.text(name),
		input: redact.value(input),
		error: false,
	};
	state.tools.set(id, tool);
	state.spans.push(tool);
};
const closeTool = (
	state: Draft,
	id: string,
	at: string | undefined,
	result: unknown,
	error: boolean,
	redact: Redactor,
): void => {
	const tool = state.tools.get(id);
	if (!tool) return;
	tool.end = at ?? tool.at;
	tool.result = safeText(redact, contentText(result));
	tool.error = error;
};
const finish = (state: Draft): Span[] =>
	state.spans.map((item): Span => {
		if (item.kind === "turn")
			return {
				...item,
				text: item.text.join("\n"),
				thinking: item.thinking.join("\n"),
			};
		return { ...item };
	});
const hasConversation = (state: Draft): boolean =>
	state.spans.some((span) => span.kind === "user" || span.kind === "turn");

/** What turning a transcript into a trace needs. */
export type TraceInput = {
	/** The transcript's lines, each parsed from JSON. */
	readonly lines: readonly unknown[];
	/** Whether the session is still being written. */
	readonly live: boolean;
	/** Applied to every text and tool input before it goes in the trace. */
	readonly redact: Redactor;
};

/** A Claude Code transcript's trace, or undefined if the lines aren't one or hold no conversation yet. */
export const claudeTrace = ({
	lines,
	live,
	redact,
}: TraceInput): WakeTrace | undefined => {
	const head = sessionHead(lines);
	const state = draft();
	let started: string | undefined;
	let ended: string | undefined;
	let title: string | undefined;
	let model: string | undefined;
	let costUsd: number | undefined;
	let hasMessage = false;
	const messages = new Map<string, TurnDraft>();
	for (const raw of lines) {
		const parsed = line.safeParse(raw);
		if (!parsed.success) continue;
		const item = parsed.data;
		if (item.timestamp) {
			started ??= item.timestamp;
			ended = item.timestamp;
		}
		if (item.type === "ai-title" && item.aiTitle)
			title = safeText(redact, item.aiTitle);
		if (item.type === "cost-state" && item.totalCostUSD !== undefined)
			costUsd = item.totalCostUSD;
		if (item.type === "attachment") {
			const attachment = block.safeParse(item.attachment);
			if (
				// Only context a hook adds is said to the session; a hook's success or exit code isn't.
				attachment.success &&
				attachment.data.type === "hook_additional_context"
			) {
				const { content } = attachment.data;
				// Claude Code keeps a hook's context as a list of strings.
				const text =
					attachment.data.text ??
					(Array.isArray(content) &&
					content.every((part) => typeof part === "string")
						? content.join("\n")
						: contentText(content));
				if (text)
					state.spans.push({
						kind: "user",
						at: item.timestamp ?? ended ?? "",
						text: safeText(redact, text),
					});
			}
			continue;
		}
		if (item.type === "user") {
			const message = claudeMessage.safeParse(item.message);
			if (!message.success) continue;
			hasMessage = true;
			const content = message.data.content;
			const text =
				typeof content === "string"
					? content
					: contentText(
							content.filter((part) => {
								const parsedBlock = block.safeParse(part);
								return parsedBlock.success && parsedBlock.data.type === "text";
							}),
						);
			if (text)
				state.spans.push({
					kind: "user",
					at: item.timestamp ?? ended ?? "",
					text: safeText(redact, text),
				});
			for (const part of blocks(content)) {
				if (part.type === "tool_result" && part.tool_use_id)
					closeTool(
						state,
						part.tool_use_id,
						item.timestamp,
						part.content,
						part.is_error ?? false,
						redact,
					);
			}
			continue;
		}
		if (item.type !== "assistant") continue;
		const message = claudeMessage.safeParse(item.message);
		if (!message.success || typeof message.data.content === "string") continue;
		hasMessage = true;
		const key = message.data.id;
		let turn = key ? messages.get(key) : undefined;
		if (!turn) {
			turn = addTurn(state, item.timestamp ?? ended ?? "", message.data.model);
			if (key) messages.set(key, turn);
			const usage = message.data.usage;
			if (usage)
				turn.tokens = {
					input: usage.input_tokens ?? 0,
					output: usage.output_tokens ?? 0,
					cacheRead: usage.cache_read_input_tokens ?? 0,
					cacheWrite: usage.cache_creation_input_tokens ?? 0,
				};
		}
		turn.end = item.timestamp ?? turn.end;
		model ??= message.data.model;
		for (const part of blocks(message.data.content)) {
			if (part.type === "text" && part.text)
				turn.text.push(safeText(redact, part.text));
			if (part.type === "thinking" && part.thinking)
				turn.thinking.push(safeText(redact, part.thinking));
			if (part.type === "tool_use" && part.id && part.name)
				addTool(
					state,
					turn,
					item.timestamp ?? turn.at,
					part.id,
					part.name,
					part.input,
					redact,
				);
		}
	}
	if (
		!hasMessage ||
		head?.source !== "claude" ||
		started === undefined ||
		ended === undefined ||
		!hasConversation(state)
	)
		return undefined;
	return {
		v: traceVersion,
		source: "claude",
		sessionId: head.id,
		startedAt: started,
		endedAt: ended,
		live,
		...(model === undefined ? {} : { model }),
		...(title === undefined ? {} : { title }),
		...(costUsd === undefined ? {} : { costUsd }),
		spans: finish(state),
	};
};

const codexText = (content: unknown): string =>
	blocks(content)
		.filter((item) => item.type === "input_text" || item.type === "output_text")
		.map((item) => item.text ?? "")
		.filter(Boolean)
		.join("\n");

/** A Codex rollout's trace, or undefined if the lines aren't one or hold no conversation yet. */
export const codexTrace = ({
	lines,
	live,
	redact,
}: TraceInput): WakeTrace | undefined => {
	const head = sessionHead(lines);
	const state = draft();
	let started: string | undefined;
	let ended: string | undefined;
	let model: string | undefined;
	let turn: TurnDraft | undefined;
	let pendingThinking: string[] = [];
	let hasMessage = false;
	for (const raw of lines) {
		const parsed = line.safeParse(raw);
		if (!parsed.success) continue;
		const item = parsed.data;
		if (item.timestamp) {
			started ??= item.timestamp;
			ended = item.timestamp;
		}
		const payload = codexPayload.safeParse(item.payload);
		if (!payload.success) continue;
		const data = payload.data;
		if (item.type === "turn_context") model = data.model ?? model;
		if (item.type === "response_item" && data.type === "message") {
			const text = codexText(data.content);
			if (data.role === "user" || data.role === "assistant") hasMessage = true;
			if (
				data.role === "user" &&
				text &&
				// Codex hands the agent's instructions and environment over as user messages.
				!text.startsWith("# AGENTS.md") &&
				!text.startsWith("<environment_context")
			)
				state.spans.push({
					kind: "user",
					at: item.timestamp ?? ended ?? "",
					text: safeText(redact, text),
				});
			if (data.role === "assistant") {
				turn = addTurn(state, item.timestamp ?? ended ?? "", model);
				turn.thinking.push(...pendingThinking);
				pendingThinking = [];
				if (text) turn.text.push(safeText(redact, text));
			}
		}
		if (item.type === "response_item" && data.type === "reasoning") {
			const text = codexText(data.content);
			if (text) pendingThinking.push(safeText(redact, text));
		}
		if (
			item.type === "response_item" &&
			(data.type === "custom_tool_call" || data.type === "function_call") &&
			data.call_id &&
			data.name
		) {
			turn ??= addTurn(state, item.timestamp ?? ended ?? "", model);
			addTool(
				state,
				turn,
				item.timestamp ?? ended ?? "",
				data.call_id,
				data.name,
				data.input ?? data.arguments,
				redact,
			);
		}
		if (
			item.type === "response_item" &&
			(data.type === "custom_tool_call_output" ||
				data.type === "function_call_output") &&
			data.call_id
		) {
			const result = output.safeParse(data.output);
			const value = result.success ? result.data.output : data.output;
			const error =
				result.success &&
				(result.data.exit_code ?? result.data.exitCode ?? 0) !== 0;
			closeTool(state, data.call_id, item.timestamp, value, error, redact);
		}
		if (item.type === "token_usage_record" && turn) {
			const usage = codexUsage.safeParse(data.usage);
			if (usage.success)
				turn.tokens = {
					input: usage.data.input_tokens ?? 0,
					output: usage.data.output_tokens ?? 0,
					cacheRead: usage.data.cached_input_tokens ?? 0,
					cacheWrite: 0,
				};
		}
		if (turn && item.timestamp) turn.end = item.timestamp;
	}
	if (
		!hasMessage ||
		head?.source !== "codex" ||
		started === undefined ||
		ended === undefined ||
		!hasConversation(state)
	)
		return undefined;
	return {
		v: traceVersion,
		source: "codex",
		sessionId: head.id,
		startedAt: started,
		endedAt: ended,
		live,
		...(model === undefined ? {} : { model }),
		spans: finish(state),
	};
};

/** The trace of a transcript of either kind, told apart by its lines. Undefined if it is neither, or holds no conversation yet. */
export const wakeTrace = (input: TraceInput): WakeTrace | undefined => {
	const source = sessionHead(input.lines)?.source;
	if (source === "claude") return claudeTrace(input);
	if (source === "codex") return codexTrace(input);
	return undefined;
};
