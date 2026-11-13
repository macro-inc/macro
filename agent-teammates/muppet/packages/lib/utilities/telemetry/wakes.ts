/**
 * Wake telemetry to Macro itself: every record goes to the agent account's
 * wakes, as it is, and the wake's model session follows it as a trace
 * (`utilities/traces`), kept up to date while the wake runs. Macro's
 * endpoints, for the agent account's user id `agent`:
 *
 * - `POST /agents/{agent}/wakes`, body the record.
 * - `PUT /agents/{agent}/wakes/{wake}/trace`, body the `WakeTrace`, at most
 *   10 MiB. One per wake; each replaces the last.
 *
 * The library makes no requests: the agent hands in a `WakeClient` that does.
 * Once `@macro-inc/sdk` has these methods, that is the SDK's (see `FORMAT.md`); until then, a fetch with the agent's API key:
 *
 *     const wakes = `${api}/agents/${encodeURIComponent(me)}/wakes`;  // me: the agent account's user id
 *     const send = async (method: string, url: string, body: unknown) => {
 *       const response = await fetch(url, {
 *         method,
 *         headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
 *         body: JSON.stringify(body),
 *       });
 *       if (!response.ok) throw new Error(`${method} ${url}: ${response.status}`);
 *     };
 *     const sink = macroSink({
 *       client: {
 *         recordWake: (record) => send("POST", wakes, record),
 *         uploadTrace: (wake, trace) => send("PUT", `${wakes}/${encodeURIComponent(wake)}/trace`, trace),
 *       },
 *       clock,
 *       traces: {
 *         transcript: (session) => readTranscript(session),  // parsed JSONL lines, or undefined
 *         secrets: credentialValues(credentials),
 *       },
 *     });
 *     wakeTelemetry({ …, sinks: [sink, …] });
 */
import type { Clock } from "../time/index.ts";
import {
	fitTrace,
	redactor,
	traceBytes,
	traceLimit,
	wakeTrace,
} from "../traces/index.ts";
import type { WakeTrace } from "../traces/trace.ts";
import type { Sink } from "./index.ts";
import type { Session, WakeRecord } from "./record.ts";

/** What sends to Macro, for the agent account muppet runs as. Either may throw or reject: that costs the record or the trace, nothing else. */
export type WakeClient = {
	/** `POST /agents/{agent}/wakes` with the record as it is. */
	readonly recordWake: (record: WakeRecord) => Promise<void>;
	/** `PUT /agents/{agent}/wakes/{wake}/trace`, replacing the wake's trace. */
	readonly uploadTrace: (wake: string, trace: WakeTrace) => Promise<void>;
};

/** Where a wake's trace comes from. */
export type WakeTraces = {
	/** The session's transcript, each JSON line parsed, or undefined if there is none (yet). Claude Code's and Codex's are both read. */
	readonly transcript: (
		session: Session,
	) => Promise<readonly unknown[] | undefined>;
	/** The exact values to redact, e.g. `credentialValues(credentials)`. Asked before every upload. */
	readonly secrets: () => Promise<readonly string[]>;
	/** How often a running wake's trace is sent again, if it changed. 60 seconds unless said. */
	readonly intervalMs?: number;
	/** The most bytes of JSON a trace may be. Macro's 10 MiB unless said. */
	readonly limit?: number;
};

type Watch = {
	stopped: boolean;
	/** The JSON last sent, so an unchanged trace isn't sent again. */
	last?: string;
	/** The upload under way, if any. */
	busy: Promise<void>;
};

/**
 * A sink that sends every record to Macro through `client`, unchanged, and,
 * given `traces`, the wake's trace: from its `session` record every
 * `intervalMs` while it runs (only when it changed), and once more, no longer
 * live, at its `end`. No call to Macro is waited on longer than `timeoutMs`
 * (10 seconds unless said), so a slow Macro holds up no other sink for long,
 * and nothing it does ever throws out of the sink.
 */
export const macroSink = ({
	client,
	clock,
	traces,
	timeoutMs = 10_000,
}: {
	readonly client: WakeClient;
	/** For the timeout and the interval. */
	readonly clock: Pick<Clock, "sleep">;
	readonly traces?: WakeTraces;
	readonly timeoutMs?: number;
}): Sink => {
	const watches = new Map<string, Watch>();

	/** Does `work`, waiting on it no longer than the timeout. Never rejects. */
	const within = async (work: () => Promise<void>): Promise<void> => {
		try {
			await Promise.race([work(), clock.sleep(timeoutMs)]);
		} catch {
			// Telemetry costs the trace or the record, never the wake.
		}
	};

	const upload = async (
		sources: WakeTraces,
		wake: string,
		session: Session,
		live: boolean,
		watch: Watch,
	): Promise<void> => {
		const lines = await sources.transcript(session);
		if (lines === undefined) return;
		const redact = redactor(await sources.secrets());
		const trace = wakeTrace({ lines, live, redact });
		if (trace === undefined) return;
		const limit = sources.limit ?? traceLimit;
		const fitted = fitTrace(trace, limit);
		const json = JSON.stringify(fitted);
		if (json === watch.last || traceBytes(fitted) > limit) return;
		await client.uploadTrace(wake, fitted);
		watch.last = json;
	};

	const follow = async (
		sources: WakeTraces,
		wake: string,
		session: Session,
		watch: Watch,
	): Promise<void> => {
		while (!watch.stopped) {
			watch.busy = within(() => upload(sources, wake, session, true, watch));
			await watch.busy;
			if (watch.stopped) return;
			await clock.sleep(sources.intervalMs ?? 60_000);
		}
	};

	return async (record) => {
		await within(() => client.recordWake(record));
		if (traces === undefined || record.session === undefined) return;
		const { session } = record;
		if (record.phase === "session") {
			if (watches.has(record.wake)) return;
			const watch: Watch = { stopped: false, busy: Promise.resolve() };
			watches.set(record.wake, watch);
			void follow(traces, record.wake, session, watch);
			return;
		}
		if (record.phase !== "end") return;
		const watch = watches.get(record.wake) ?? {
			stopped: true,
			busy: Promise.resolve(),
		};
		watches.delete(record.wake);
		watch.stopped = true;
		// A live upload still under way would otherwise land after the last one.
		await watch.busy;
		await within(() => upload(traces, record.wake, session, false, watch));
	};
};
