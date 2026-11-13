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
 *     const send = async (method: string, url: string, body: unknown, signal?: AbortSignal) => {
 *       const response = await fetch(url, {
 *         method,
 *         headers: { "x-macro-user-api-key": key, "content-type": "application/json" },
 *         body: JSON.stringify(body),
 *         signal,
 *       });
 *       // 404 for a record: wakes are off for this account; stop for the run.
 *       if (response.status === 404 && method === "POST") throw new WakesUnavailable();
 *       if (!response.ok) throw new Error(`${method} ${url}: ${response.status}`);
 *     };
 *     const sink = macroSink({
 *       client: {
 *         recordWake: (record, signal) => send("POST", wakes, record, signal),
 *         uploadTrace: (wake, trace, signal) =>
 *           send("PUT", `${wakes}/${encodeURIComponent(wake)}/trace`, trace, signal),
 *       },
 *       clock,
 *       secrets: credentialValues(credentials),
 *       traces: {
 *         transcript: (session) => readTranscript(session),  // parsed JSONL lines, or undefined
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

/**
 * Thrown (or rejected with) by a `WakeClient` when Macro answers that this
 * agent account has no wakes, e.g. a 404 while `enable-agent-dashboards` is off
 * for it: the sink then sends nothing more for the rest of the run.
 */
export class WakesUnavailable extends Error {
	constructor(message = "Macro has no wakes for this agent account") {
		super(message);
		this.name = "WakesUnavailable";
	}
}

/**
 * What sends to Macro, for the agent account muppet runs as. Either may throw
 * or reject: that costs the record or the trace, nothing else, unless it is a
 * `WakesUnavailable`. Each is handed a signal that aborts once the sink stops
 * waiting on it; a client should pass it to `fetch`.
 */
export type WakeClient = {
	/** `POST /agents/{agent}/wakes` with the record as it is. */
	readonly recordWake: (
		record: WakeRecord,
		signal?: AbortSignal,
	) => Promise<void>;
	/** `PUT /agents/{agent}/wakes/{wake}/trace`, replacing the wake's trace. */
	readonly uploadTrace: (
		wake: string,
		trace: WakeTrace,
		signal?: AbortSignal,
	) => Promise<void>;
};

/** Where a wake's trace comes from. */
export type WakeTraces = {
	/** The session's transcript, each JSON line parsed, or undefined if there is none (yet). Claude Code's and Codex's are both read. */
	readonly transcript: (
		session: Session,
	) => Promise<readonly unknown[] | undefined>;
	/** How often a running wake's trace is sent again, if it changed. 60 seconds unless said. */
	readonly intervalMs?: number;
	/** How often it is sent again even if it didn't, so Macro hears the wake is alive through a long silent step. 10 minutes unless said. */
	readonly heartbeatMs?: number;
	/** The most bytes of JSON a trace may be. Macro's 10 MiB unless said. */
	readonly limit?: number;
};

type Watch = {
	stopped: boolean;
	/** The JSON last sent, so an unchanged trace isn't sent again before the heartbeat. */
	last?: string;
	/** Intervals since the trace was last sent. */
	quiet: number;
	/** The upload under way, if any, settling when its request does (not when the sink stopped waiting on it). */
	inflight: Promise<void>;
};

/**
 * A sink that sends every record to Macro through `client`, unchanged, and,
 * given `traces`, the wake's trace: from its `session` record every
 * `intervalMs` while it runs (when it changed, or every `heartbeatMs` anyway),
 * and once more, no longer live, after its `end`. Every trace, and a record's
 * error message and summaries, traces or not, are redacted with `secrets`. No call to Macro is waited on longer
 * than `timeoutMs` (10 seconds unless said): past it, the call's signal
 * aborts. The final trace is sent in the background, so the end of a wake
 * waits only on its record; it first waits (no longer than the timeout) for a
 * live upload still running, so it can't land after it. A slow Macro holds up
 * no other sink for long, nothing it does ever throws out of the sink, and
 * once the client throws `WakesUnavailable` the sink does nothing more.
 */
export const macroSink = ({
	client,
	clock,
	secrets,
	traces,
	timeoutMs = 10_000,
}: {
	readonly client: WakeClient;
	/** For the timeout and the interval. */
	readonly clock: Pick<Clock, "sleep">;
	/**
	 * The exact values to redact, e.g. `credentialValues(credentials)`. Asked
	 * before every record with free text and every trace upload; if it
	 * rejects, that text becomes `[secret]` and that upload is skipped.
	 */
	readonly secrets: () => Promise<readonly string[]>;
	readonly traces?: WakeTraces;
	readonly timeoutMs?: number;
}): Sink => {
	const watches = new Map<string, Watch>();
	let unavailable = false;

	/**
	 * Starts `work`: `done` settles when it does and never rejects; `waited`
	 * settles when it does or the timeout passes, aborting its signal then.
	 */
	const start = (
		work: (signal: AbortSignal) => Promise<void>,
	): { readonly done: Promise<void>; readonly waited: Promise<void> } => {
		const controller = new AbortController();
		const done = (async () => {
			try {
				await work(controller.signal);
			} catch (error) {
				// Telemetry costs the trace or the record, never the wake.
				if (error instanceof WakesUnavailable) {
					unavailable = true;
					for (const watch of watches.values()) watch.stopped = true;
				}
			}
		})();
		const waited = Promise.race([
			done.then(() => true),
			clock.sleep(timeoutMs).then(() => false),
		]).then((finished) => {
			if (!finished) controller.abort();
		});
		return { done, waited };
	};

	/** Does `work`, waiting on it no longer than the timeout. Never rejects. */
	const within = (work: (signal: AbortSignal) => Promise<void>) =>
		start(work).waited;

	/**
	 * The record with its free text (error message, summaries) redacted with
	 * `secrets`. If they can't be read, that text is dropped.
	 */
	const redacted = async (record: WakeRecord): Promise<WakeRecord> => {
		const error = record.phase === "end" ? record.error : undefined;
		const outcome = record.phase === "end" ? record.outcome : undefined;
		if (
			error === undefined &&
			outcome?.summary === undefined &&
			record.trigger.summary === undefined
		)
			return record;
		const text = await secrets().then(
			(secrets) => redactor(secrets).text,
			() => () => "[secret]",
		);
		const trigger =
			record.trigger.summary === undefined
				? record.trigger
				: { ...record.trigger, summary: text(record.trigger.summary) };
		if (record.phase !== "end") return { ...record, trigger };
		return {
			...record,
			trigger,
			...(error === undefined
				? {}
				: { error: { ...error, message: text(error.message) } }),
			...(outcome?.summary === undefined
				? {}
				: { outcome: { ...outcome, summary: text(outcome.summary) } }),
		};
	};

	const upload = async (
		sources: WakeTraces,
		wake: string,
		session: Session,
		live: boolean,
		watch: Watch,
		signal: AbortSignal,
	): Promise<void> => {
		const lines = await sources.transcript(session);
		if (lines === undefined) return;
		// A credential that can't be read rejects here: no trace this time.
		const redact = redactor(await secrets());
		const trace = wakeTrace({ lines, live, redact });
		if (trace === undefined) return;
		const limit = sources.limit ?? traceLimit;
		const fitted = fitTrace(trace, limit);
		const json = JSON.stringify(fitted);
		const interval = sources.intervalMs ?? 60_000;
		const heartbeat = Math.max(
			1,
			Math.round((sources.heartbeatMs ?? 600_000) / interval),
		);
		const due = !live || json !== watch.last || watch.quiet >= heartbeat;
		if (!due || traceBytes(fitted) > limit) return;
		if (signal.aborted || unavailable) return;
		await client.uploadTrace(wake, fitted, signal);
		watch.last = json;
		watch.quiet = 0;
	};

	const follow = async (
		sources: WakeTraces,
		wake: string,
		session: Session,
		watch: Watch,
	): Promise<void> => {
		while (!watch.stopped) {
			const call = start((signal) =>
				upload(sources, wake, session, true, watch, signal),
			);
			watch.inflight = call.done;
			await call.waited;
			if (watch.stopped) return;
			await clock.sleep(sources.intervalMs ?? 60_000);
			watch.quiet += 1;
		}
	};

	return async (record) => {
		if (unavailable) return;
		const sent = await redacted(record);
		await within((signal) => client.recordWake(sent, signal));
		if (unavailable) return;
		if (traces === undefined || record.session === undefined) return;
		const { session } = record;
		if (record.phase === "session") {
			if (watches.has(record.wake)) return;
			const watch: Watch = {
				stopped: false,
				quiet: 0,
				inflight: Promise.resolve(),
			};
			watches.set(record.wake, watch);
			void follow(traces, record.wake, session, watch);
			return;
		}
		if (record.phase !== "end") return;
		const watch = watches.get(record.wake) ?? {
			stopped: true,
			quiet: 0,
			inflight: Promise.resolve(),
		};
		watches.delete(record.wake);
		watch.stopped = true;
		// In the background: the wake's end doesn't wait on its trace.
		void (async () => {
			// A live upload still under way would otherwise land after the last one.
			await Promise.race([watch.inflight, clock.sleep(timeoutMs)]);
			await within((signal) =>
				upload(traces, record.wake, session, false, watch, signal),
			);
		})();
	};
};
