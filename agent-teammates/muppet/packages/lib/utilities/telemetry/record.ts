/**
 * The wake record: the one format every muppet system records an agent
 * invocation in. A record is written when a wake starts, again when its
 * session is known, and last when it ends; each carries everything known so
 * far, so the last one read for a wake is the whole truth about it. Sinks
 * write it somewhere: `jsonlSink` as it is, one JSON object a line, and
 * `otlpSink` as OpenTelemetry (see `otlp.ts` for the attribute names).
 */
import { z } from "zod";

/** The version of this format, `v` on every record. */
export const version = 1;

/** What kind of thing woke the agent. */
export const TriggerKind = z.enum([
	/** A schedule came due. */
	"schedule",
	/** Someone wrote to the agent: chat, mail, a call. */
	"message",
	/** Something happened in a system the agent watches: a PR, a report, a board item. */
	"event",
	/** A job the agent started changed or finished. */
	"job",
	/** A person ran it by hand. */
	"manual",
]);
export type TriggerKind = z.infer<typeof TriggerKind>;

/** What woke the agent. */
export const Trigger = z.object({
	kind: TriggerKind,
	/** The event source that fired, as the behavior names it, e.g. `schedules` or `workMail`. */
	source: z.string(),
	/** What within the source, when it has a name, e.g. the schedule's. Low cardinality. */
	name: z.string().optional(),
	/** The ids of what it is about, by what they identify, e.g. `{ pr: "macro-inc/macro#10357" }`, `report`, `board_item`, `macro_message`, `schedule`. */
	ids: z.record(z.string(), z.string()),
	/** One line a person reads. */
	summary: z.string().optional(),
});
export type Trigger = z.infer<typeof Trigger>;

/** The model session a wake ran as. */
export const Session = z.object({
	/** The session's id: Claude Code's session id, Codex's conversation id. It names the transcript. */
	id: z.string().optional(),
	/** What ran it, e.g. `claude` or `codex`. */
	agent: z.string(),
	/** Who serves the model, an OpenTelemetry `gen_ai.provider.name`, e.g. `anthropic` or `openai`. */
	provider: z.string().optional(),
	model: z.string().optional(),
});
export type Session = z.infer<typeof Session>;

/** How a wake ended, apart from what came of it. */
export const Status = z.enum(["ok", "failed", "timeout", "cancelled"]);
export type Status = z.infer<typeof Status>;

/** Something a wake did that the system saw for itself, e.g. a PR it opened. */
export type Effect<Kind extends string = string> = {
	readonly kind: Kind;
	/** Which one, e.g. the PR's number. */
	readonly id?: string;
	readonly url?: string;
};
const AnyEffect = z.object({
	kind: z.string(),
	id: z.string().optional(),
	url: z.string().optional(),
});

/** What came of a wake, and how that is known. See `outcome.ts` for the rule. */
export const Classified = z.object({
	/** One of the system's declared outcomes, or `unclassified`. */
	name: z.string(),
	/** Where `name` came from: the agent's report, the effects the system saw, or neither. */
	source: z.enum(["reported", "observed", "none"]),
	/** How the report held up against the effects. */
	check: z.enum(["confirmed", "unverifiable", "contradicted", "not_reported"]),
	/** What the agent reported, whatever became of it. */
	reported: z.string().optional(),
	/** What the effects alone imply. */
	observed: z.string().optional(),
	/** The agent's one line on what it did. */
	summary: z.string().optional(),
});
export type Classified = z.infer<typeof Classified>;

const Usage = z.object({
	inputTokens: z.number().optional(),
	outputTokens: z.number().optional(),
	costUsd: z.number().optional(),
	turns: z.number().optional(),
});
export type Usage = z.infer<typeof Usage>;

const common = {
	v: z.literal(version),
	/** The system that woke its agent, e.g. `pr-factory`. */
	system: z.string(),
	/** This wake's id, unique within the system. */
	wake: z.string(),
	/** Where the wake sits in a trace: lower-case hex, as OpenTelemetry has them. */
	trace: z.object({
		traceId: z.string(),
		spanId: z.string(),
		parentSpanId: z.string().optional(),
	}),
	/** Present, and `invoke_workflow`, when the system's own code did the work and no model was woken. Absent for an agent's wake. */
	operation: z.literal("invoke_workflow").optional(),
	/** The wake, and its system, that started this one. */
	parent: z
		.object({ wake: z.string().optional(), system: z.string().optional() })
		.optional(),
	trigger: Trigger,
	/** ISO 8601 in UTC, to the millisecond. */
	startedAt: z.string(),
	session: Session.optional(),
	/** The Herdr terminal the wake ran in, by address or name. */
	terminal: z.string().optional(),
};

export const Started = z.object({
	...common,
	/** `start` when the wake begins, `session` when its session is first known. */
	phase: z.enum(["start", "session"]),
});
export type Started = z.infer<typeof Started>;

export const Ended = z.object({
	...common,
	phase: z.literal("end"),
	endedAt: z.string(),
	durationMs: z.number(),
	status: Status,
	error: z
		.object({
			/** A low-cardinality name for what went wrong, e.g. `timeout` or `error_max_budget_usd`. */
			type: z.string(),
			message: z.string(),
		})
		.optional(),
	outcome: Classified,
	effects: z.array(AnyEffect),
	usage: Usage.optional(),
});
export type Ended = z.infer<typeof Ended>;

export const WakeRecord = z.discriminatedUnion("phase", [Started, Ended]);
export type WakeRecord = z.infer<typeof WakeRecord>;
