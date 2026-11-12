/**
 * Wake telemetry through Macro's own telemetry framework,
 * `@macro-inc/observability` (`packages/observability` in the Macro
 * repository): a wake is one of its spans, and each record one of its logs,
 * so muppet has no exporter, batching or OpenTelemetry dependency of its own.
 *
 * The framework is one object for the whole process, so the agent sets it up
 * at its entrypoint and hands it in:
 *
 *     import { Telemetry } from "@macro-inc/observability";
 *     import { createNodeTracingProvider } from "@macro-inc/observability/node";
 *
 *     const config = {
 *       serviceName: "pr-factory",                       // the system
 *       environment: "big-pickle",
 *       tracesUrl: `${collector}/v1/traces`,
 *       logsUrl: `${collector}/v1/logs`,
 *       resourceAttributes: { "service.namespace": namespace },
 *       enabled: async () => true,
 *     };
 *     await Telemetry.init({
 *       ...config,
 *       tracingProvider: (resource, getUserId, sampling) =>
 *         createNodeTracingProvider(config, resource, getUserId, sampling),
 *     });
 *     await Telemetry.flush(); // a span hands on its trace only once this has settled
 *
 *     const macro = macroTelemetry({ telemetry: Telemetry });
 *     wakeTelemetry({ …, spans: macro.spans, sinks: [macro.sink, …] });
 *
 * The wake's span is opened when the wake begins and the record takes its
 * trace and span ids from it, so anything the wake starts with `wake.env()`
 * is a child of that span. When the wake ends the span gets the record's
 * attributes (`attributes.ts`) and ends at the record's time. Each record is
 * logged inside the span, so the log carries its trace.
 */
import { attributes, line, type Value } from "./attributes.ts";
import type {
	Attribute,
	Attributes,
	MacroSpan,
	MacroTelemetry,
} from "./framework.ts";
import type { Sink, Spans } from "./index.ts";
import type { WakeRecord } from "./record.ts";

const milliseconds = (iso: string): number =>
	Temporal.Instant.from(iso).epochMilliseconds;

const plain = (value: Value): Attribute =>
	typeof value === "object" ? [...value] : value;

const logged = (record: WakeRecord): Attributes =>
	Object.fromEntries(
		Object.entries(attributes(record)).map(([key, value]) => [
			key,
			plain(value),
		]),
	);

/**
 * `spans` and a `sink` for `wakeTelemetry` that record wakes through
 * `telemetry`. Neither ever throws: telemetry costs the record, never the
 * wake. Nothing waits on a collector; the framework sends in the background.
 */
export const macroTelemetry = ({
	telemetry,
}: {
	/** `Telemetry` from `@macro-inc/observability`, already initialised. */
	readonly telemetry: MacroTelemetry;
}): {
	readonly spans: Spans;
	readonly sink: Sink;
	/** Resolves once what is waiting has been sent, or given up on. For a process about to exit. */
	readonly flush: () => Promise<void>;
} => {
	const open = new Map<string, MacroSpan>();

	const log = (record: WakeRecord): void => {
		const message = line(record);
		const details = logged(record);
		if (record.phase !== "end" || record.status === "ok")
			telemetry.info(message, details);
		else if (record.status === "cancelled") telemetry.warn(message, details);
		else telemetry.error(message, details);
	};

	return {
		spans: ({ wake, name, startedAtMs, parent }) => {
			const start = (): MacroSpan =>
				telemetry.span(name, { startTime: startedAtMs });
			const span =
				parent?.traceId === undefined || parent.spanId === undefined
					? start()
					: telemetry
							.remoteContext(`00-${parent.traceId}-${parent.spanId}-01`)
							.run(start);
			open.set(wake, span);
			return span.traceparent();
		},
		sink: async (record) => {
			try {
				const span = open.get(record.wake);
				if (span === undefined) {
					log(record);
					return;
				}
				span.run(() => log(record));
				if (record.phase !== "end") return;
				open.delete(record.wake);
				for (const [name, value] of Object.entries(attributes(record)))
					span.setAttr(name, plain(value));
				if (record.status !== "ok")
					span.error(new Error(record.error?.message ?? record.status));
				span.end(milliseconds(record.endedAt));
			} catch {
				// Telemetry costs the record, never the wake.
			}
		},
		flush: () => telemetry.flush().catch(() => undefined),
	};
};
