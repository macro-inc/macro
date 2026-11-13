/**
 * Wake telemetry: for every time a system wakes its agent, a record of what
 * triggered it and what came of it, in one format whatever the system (see
 * `record.ts`), sent wherever the system says: Macro's telemetry framework
 * (`macroTelemetry`), the agent account's wakes in Macro, with each wake's
 * model session as a trace (`macroSink`), a JSON Lines file (`jsonlSink`), or
 * a sink of its own.
 *
 * It is opt-in. A system that wants it builds one `wakeTelemetry` with its
 * name and its closed set of outcomes, wraps its agent with
 * `telemetry.agent`, puts `telemetry` in its context, and gives its agent a
 * typed `reportOutcome` function in a module of its own, so that a script
 * reporting an outcome outside the set doesn't type-check:
 *
 *     export const outcomes = defineOutcomes<"pr_opened">()({
 *       fixed_pr_opened: { description: "…", evidence: ["pr_opened"] },
 *       no_repro: { description: "…" },
 *     });
 *     export const telemetry = wakeTelemetry({ system: "desktop-factory", outcomes, sinks, clock, id, hex });
 *
 *     // behavior/capabilities/outcome/index.ts
 *     /** Say what came of this wake, once, before you finish. *\/
 *     export const reportOutcome = (
 *       { telemetry }: Context,
 *       input: { wake: string; outcome: OutcomeOf<typeof outcomes>; summary: string },
 *     ) => telemetry.report(input);
 *
 * What came of a wake is never decided by a model: see `outcome.ts` for the
 * rule. Telemetry never breaks a wake: a sink that throws, or a collector
 * that is down, costs the record and nothing else.
 */
import type {
	Agent,
	EventContext,
	WakeContext,
	Woke,
} from "../../core/agent.ts";
import { describeError } from "../../core/error.ts";
import type { Clock } from "../time/index.ts";
import {
	classify,
	declared,
	type Outcomes,
	type Reported,
	unclassified,
} from "./outcome.ts";
import {
	type Effect,
	type Ended,
	type Session,
	type Started,
	type Status,
	type Trigger,
	type Usage,
	version,
	type WakeRecord,
} from "./record.ts";

export {
	classify,
	defineOutcomes,
	type Outcomes,
	unclassified,
} from "./outcome.ts";
export { attributes, line, namespace } from "./attributes.ts";
export type { MacroSpan, MacroTelemetry } from "./framework.ts";
export { macroTelemetry } from "./macro.ts";
export { macroSink, type WakeClient, type WakeTraces } from "./wakes.ts";
export {
	type Classified,
	type Effect,
	Ended,
	type Session,
	Started,
	type Status,
	type Trigger,
	type TriggerKind,
	type Usage,
	WakeRecord,
} from "./record.ts";

/** The names of a declared set of outcomes. */
export type OutcomeOf<Declared> =
	Declared extends Outcomes<infer Outcome, infer _Kind> ? Outcome : never;

/** Where records go. A sink that throws or rejects is ignored. */
export type Sink = (record: WakeRecord) => Promise<void>;

/**
 * Opens a span for a wake that is beginning, in whatever traces the system,
 * and returns its W3C `traceparent`, which the wake's record takes its trace
 * and span ids from. Undefined, or anything else, leaves the record to make
 * ids of its own. `macroTelemetry` provides one.
 */
export type Spans = (wake: {
	readonly wake: string;
	/** The span's name: the operation, then the system. */
	readonly name: string;
	/** Unix time in milliseconds. */
	readonly startedAtMs: number;
	readonly parent?: Parent;
}) => string | undefined;

/** The wake, system and trace a wake was started from. */
export type Parent = {
	readonly wake?: string;
	readonly system?: string;
	readonly traceId?: string;
	readonly spanId?: string;
};

const wakeVariable = "MUPPET_WAKE_ID";
const systemVariable = "MUPPET_SYSTEM";
const traceVariable = "TRACEPARENT";
/** W3C trace context: version, trace id, parent span id, flags. */
const traceparent = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/**
 * The parent a process was started under, from the variables `Wake.env`
 * gives the things a wake starts. Undefined when it was started under none.
 */
export const parentFromEnv = (
	env: Readonly<Record<string, string | undefined>>,
): Parent | undefined => {
	const [, traceId, spanId] = traceparent.exec(env[traceVariable] ?? "") ?? [];
	const wake = env[wakeVariable];
	const system = env[systemVariable];
	const parent: Parent = {
		...(wake === undefined ? {} : { wake }),
		...(system === undefined ? {} : { system }),
		...(traceId === undefined ? {} : { traceId }),
		...(spanId === undefined ? {} : { spanId }),
	};
	return Object.keys(parent).length === 0 ? undefined : parent;
};

/** One wake under way: what is learned about it as it runs, and its end. */
export type Wake<Outcome extends string, Kind extends string> = {
	readonly id: string;
	/** The session it runs as, as soon as that is known. May be called again as more is. */
	readonly session: (
		session: Partial<Session> & Pick<Session, "agent">,
	) => void;
	/** The Herdr terminal it runs in, if not the system's own. */
	readonly terminal: (address: string) => void;
	readonly usage: (usage: Usage) => void;
	/** Something it did that the system saw for itself. */
	readonly effect: (effect: Effect<Kind>) => void;
	/** What the agent says came of it. The last report stands. */
	readonly report: (reported: Reported<Outcome>) => void;
	/** Names what went wrong, e.g. `timeout`, for an agent whose wake then fails. */
	readonly error: (type: string) => void;
	/** The variables to start a job or an agent with, so that its own wakes are recorded under this one. */
	readonly env: () => Readonly<Record<string, string>>;
	/** Ends the wake, classifies it, and resolves with its record once every sink has been handed it. */
	readonly end: (how: {
		readonly status: Status;
		readonly error?: { readonly type: string; readonly message: string };
	}) => Promise<Ended>;
};

/** An agent that says what it learns about its wake as it runs. */
export type ObservedWake<Outcome extends string, Kind extends string> = (
	wake: WakeContext,
	observe: Wake<Outcome, Kind>,
) => Promise<Woke>;

export type Telemetry<Outcome extends string, Kind extends string> = {
	readonly system: string;
	readonly outcomes: Outcomes<Outcome, Kind>;
	/** Starts recording a wake. For an agent, `agent` does this; call it directly for an invocation that wakes no model. */
	readonly begin: (
		trigger: Trigger,
		options?: {
			readonly parent?: Parent;
			/** False for work the system's own code does without waking a model: it is recorded as a workflow, not an agent. */
			readonly model?: boolean;
		},
	) => Wake<Outcome, Kind>;
	/** The ids of the wakes under way. */
	readonly running: () => readonly string[];
	/**
	 * Records what the agent says came of a wake. This is what a system's
	 * `reportOutcome` function calls. `wake` may be left out while exactly one
	 * wake is running. Throws, saying what is allowed, for an outcome outside
	 * the declared set or a wake that isn't running.
	 */
	readonly report: (input: {
		readonly wake?: string;
		readonly outcome: string;
		readonly summary?: string;
	}) => { readonly wake: string; readonly outcome: Outcome };
	/** Records something a wake did that the system saw for itself, from the capability that did it. `wake` as for `report`. */
	readonly effect: (input: Effect<Kind> & { readonly wake?: string }) => void;
	/** What a wake's system prompt is given: its id, and the outcomes it must pick from. */
	readonly instructions: (wake: string) => string;
	/**
	 * An agent whose every wake is recorded: begun with the trigger its event
	 * maps to, given `instructions` at the end of its system prompt, and ended
	 * with how it went. `effects` is asked once the agent is done, for what the
	 * system can see came of it.
	 */
	readonly agent: (observed: {
		readonly trigger: (event: EventContext) => Trigger;
		readonly wake: ObservedWake<Outcome, Kind>;
		readonly effects?: (
			event: EventContext,
			woke: Woke,
		) => Promise<readonly Effect<Kind>[]>;
	}) => Agent;
};

/** The provider behind the agents we know, as OpenTelemetry names them. */
const providers: Readonly<Record<string, string>> = {
	claude: "anthropic",
	codex: "openai",
};

/** What `spans` says the wake's span is, or undefined if there is none or it threw. */
const opened = (
	spans: Spans | undefined,
	wake: Parameters<Spans>[0],
): string | undefined => {
	try {
		return spans?.(wake);
	} catch {
		return undefined;
	}
};

const traceBytes = 16;
const spanBytes = 8;

const milliseconds = (at: Temporal.Instant): string =>
	at.toString({ smallestUnit: "millisecond" });

export const wakeTelemetry = <Outcome extends string, Kind extends string>({
	system,
	outcomes,
	sinks,
	clock,
	id,
	hex,
	spans,
	terminal: ownTerminal,
	parent: ownParent,
	instructions: instruct = defaultInstructions,
}: {
	/** The system's name, e.g. `pr-factory`. Low cardinality: it is a label. */
	readonly system: string;
	readonly outcomes: Outcomes<Outcome, Kind>;
	readonly sinks: readonly Sink[];
	readonly clock: Pick<Clock, "now">;
	/** A fresh id for a wake. */
	readonly id: () => string;
	/** This many random bytes as lower-case hex, for trace and span ids when `spans` gives none. */
	readonly hex: (bytes: number) => string;
	/** Opens each wake's span, which then gives the record its trace and span ids. */
	readonly spans?: Spans;
	/** The Herdr terminal the system itself runs in, which a wake is in unless it says otherwise. */
	readonly terminal?: string;
	/** What the system itself was started under, which a wake is under unless it says otherwise. */
	readonly parent?: Parent;
	/** Replaces the words a wake is told how to report its outcome with. */
	readonly instructions?: (
		wake: string,
		outcomes: Outcomes<Outcome, Kind>,
	) => string;
}): Telemetry<Outcome, Kind> => {
	const running = new Map<
		string,
		{
			readonly report: (reported: Reported<Outcome>) => void;
			readonly effect: (effect: Effect<Kind>) => void;
		}
	>();
	const names = (): string => Object.keys(outcomes).join(", ");

	// Records reach every sink in the order they were made, one at a time.
	let last: Promise<void> = Promise.resolve();
	const emit = (record: WakeRecord): Promise<void> => {
		last = last.then(async () => {
			await Promise.all(
				sinks.map(async (sink) => {
					try {
						await sink(record);
					} catch {
						// Telemetry costs the record, never the wake.
					}
				}),
			);
		});
		return last;
	};

	const one = (wake: string | undefined): string => {
		const ids = [...running.keys()];
		if (wake !== undefined) {
			if (!running.has(wake))
				throw new Error(
					`wake ${wake} is not running${ids.length === 0 ? "" : `; running: ${ids.join(", ")}`}`,
				);
			return wake;
		}
		const [only, ...others] = ids;
		if (only === undefined) throw new Error("no wake is running");
		if (others.length > 0)
			throw new Error(
				`several wakes are running; say which: ${ids.join(", ")}`,
			);
		return only;
	};

	const begin: Telemetry<Outcome, Kind>["begin"] = (trigger, options = {}) => {
		const parent = options.parent ?? ownParent;
		const wake = id();
		const startedAt = clock.now();
		const operation =
			options.model === false ? "invoke_workflow" : "invoke_agent";
		const [, openedTrace, openedSpan] =
			traceparent.exec(
				opened(spans, {
					wake,
					name: `${operation} ${system}`,
					startedAtMs: startedAt.epochMilliseconds,
					...(parent === undefined ? {} : { parent }),
				}) ?? "",
			) ?? [];
		const traceId = openedTrace ?? parent?.traceId ?? hex(traceBytes);
		const trace = {
			traceId,
			spanId: openedSpan ?? hex(spanBytes),
			...(parent?.traceId !== traceId || parent.spanId === undefined
				? {}
				: { parentSpanId: parent.spanId }),
		};
		let session: Session | undefined;
		let terminal = ownTerminal;
		let usage: Usage | undefined;
		let reported: Reported<Outcome> | undefined;
		let failedAs: string | undefined;
		const effects: Effect<Kind>[] = [];

		const sofar = (): Omit<Started, "phase"> => ({
			v: version,
			system,
			wake,
			trace,
			...(parent?.wake === undefined && parent?.system === undefined
				? {}
				: {
						parent: {
							...(parent.wake === undefined ? {} : { wake: parent.wake }),
							...(parent.system === undefined ? {} : { system: parent.system }),
						},
					}),
			...(options.model === false ? { operation: "invoke_workflow" } : {}),
			trigger,
			startedAt: milliseconds(startedAt),
			...(session === undefined ? {} : { session }),
			...(terminal === undefined ? {} : { terminal }),
		});
		const started = (phase: Started["phase"]): Started => ({
			...sofar(),
			phase,
		});

		running.set(wake, {
			report: (next) => {
				reported = next;
			},
			effect: (effect) => {
				effects.push(effect);
			},
		});
		void emit(started("start"));

		return {
			id: wake,
			session: (next) => {
				const known = session?.id !== undefined;
				const provider = next.provider ?? providers[next.agent];
				session = {
					...session,
					...next,
					...(provider === undefined ? {} : { provider }),
				};
				if (!known && session.id !== undefined) void emit(started("session"));
			},
			terminal: (address) => {
				terminal = address;
			},
			usage: (next) => {
				usage = { ...usage, ...next };
			},
			effect: (effect) => {
				effects.push(effect);
			},
			report: (next) => {
				reported = next;
			},
			error: (type) => {
				failedAs = type;
			},
			env: () => ({
				[wakeVariable]: wake,
				[systemVariable]: system,
				[traceVariable]: `00-${trace.traceId}-${trace.spanId}-01`,
			}),
			end: async ({ status, error }) => {
				running.delete(wake);
				const endedAt = clock.now();
				const failure =
					error ??
					(status === "ok" || failedAs === undefined
						? undefined
						: { type: failedAs, message: failedAs });
				const ended: Ended = {
					...sofar(),
					phase: "end",
					endedAt: milliseconds(endedAt),
					durationMs: Math.round(
						endedAt.since(startedAt).total("milliseconds"),
					),
					status,
					...(failure === undefined ? {} : { error: failure }),
					outcome: classify(outcomes, {
						...(reported === undefined ? {} : { reported }),
						effects,
					}),
					effects: [...effects],
					...(usage === undefined ? {} : { usage }),
				};
				await emit(ended);
				return ended;
			},
		};
	};

	const instructions = (wake: string): string => instruct(wake, outcomes);

	return {
		system,
		outcomes,
		begin,
		running: () => [...running.keys()],
		report: ({ wake, outcome, summary }) => {
			if (!declared(outcomes, outcome))
				throw new Error(
					`${outcome} is not an outcome of ${system}; it is one of: ${names()}. If none fits, report nothing: the wake is recorded as ${unclassified}.`,
				);
			const found = one(wake);
			running
				.get(found)
				?.report({ outcome, ...(summary === undefined ? {} : { summary }) });
			return { wake: found, outcome };
		},
		effect: ({ wake, ...effect }) => {
			running.get(one(wake))?.effect(effect);
		},
		instructions,
		agent: ({ trigger, wake: run, effects }) => ({
			wake: async (context) => {
				const wake = begin(trigger(context.event));
				let failedAs: string | undefined;
				const woke = await run(
					{
						...context,
						systemPrompt: [context.systemPrompt, instructions(wake.id)].join(
							"\n\n",
						),
					},
					{
						...wake,
						error: (type) => {
							failedAs = type;
						},
					},
				).catch(
					(error: unknown): Woke => ({
						kind: "failed",
						error: describeError(error),
					}),
				);
				const seen =
					effects === undefined
						? []
						: await effects(context.event, woke).catch(() => []);
				for (const effect of seen) wake.effect(effect);
				const type = failedAs ?? "error";
				await wake.end(
					woke.kind === "done"
						? { status: "ok" }
						: {
								status: type === "timeout" ? "timeout" : "failed",
								error: { type, message: woke.error },
							},
				);
				return woke;
			},
		}),
	};
};

const defaultInstructions = <Outcome extends string, Kind extends string>(
	wake: string,
	outcomes: Outcomes<Outcome, Kind>,
): string =>
	[
		"## Reporting your outcome",
		`This wake's id is \`${wake}\`. Before you finish, call \`reportOutcome\` once with \`{ wake: "${wake}", outcome, summary }\`: \`summary\` is one line on what you did, and \`outcome\` is exactly one of:`,
		Object.entries<Outcomes<Outcome, Kind>[Outcome]>(outcomes)
			.map(([name, { description }]) => `- ${name}: ${description}`)
			.join("\n"),
		`Report what happened, not what you hoped for: it is checked against what you actually did. If none fits, don't report: the wake is recorded as ${unclassified}.`,
	].join("\n\n");

/** A sink that appends each record to a JSON Lines file, as it is. */
export const jsonlSink =
	({
		file,
		append,
	}: {
		readonly file: string;
		/** Appends text to the file, creating it and its directory if needed. */
		readonly append: (path: string, text: string) => Promise<void>;
	}): Sink =>
	(record) =>
		append(file, `${JSON.stringify(record)}\n`);
