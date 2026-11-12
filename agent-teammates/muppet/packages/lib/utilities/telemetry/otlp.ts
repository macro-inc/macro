/**
 * The wake record as OpenTelemetry, through OpenTelemetry's own SDK and OTLP
 * exporters: every record is a log record, and an ended wake is a span too,
 * so a wake is already the root (or a child) of a trace that later spans can
 * hang under. The SDK does the encoding, the batching and the sending; what
 * is here is only which attributes a record becomes.
 *
 * Attribute names follow the GenAI semantic conventions where they fit, as
 * of open-telemetry/semantic-conventions-genai at 2026-11-06 (all still in
 * Development): the span is their "invoke agent internal" span, named
 * `invoke_agent {gen_ai.agent.name}`, of kind INTERNAL, with
 * `gen_ai.operation.name` (`invoke_agent`, or `invoke_workflow` for work
 * the system's code did without a model), `gen_ai.agent.name` (the system),
 * `gen_ai.conversation.id` (the session id), `gen_ai.request.model`,
 * `gen_ai.usage.input_tokens`/`output_tokens` and `error.type`.
 * `gen_ai.provider.name` is kept although the convention no longer asks for
 * it on this span. `session.id` repeats the session id under the name Claude
 * Code's own telemetry uses, so the two join. Everything the conventions
 * have no name for is under `muppet.`: see `attributes`.
 */
import {
	type Attributes,
	type HrTime,
	ROOT_CONTEXT,
	SeverityNumber,
	SpanKind,
	SpanStatusCode,
	TraceFlags,
	trace,
} from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	type LogRecordExporter,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
	BatchSpanProcessor,
	type SpanExporter,
	TracerProvider,
} from "@opentelemetry/sdk-trace";
import type { Ended, WakeRecord } from "./record.ts";

/** What every record of a system is sent under. */
export type Resource = {
	/** The system, as `service.name`; `service.namespace` is always `muppet`. */
	readonly system: string;
	/** Further resource attributes, e.g. `host.name`. */
	readonly attributes?: Readonly<Record<string, string>>;
};

type Value = string | number | boolean | readonly string[];

const scope = { name: "muppet.telemetry", version: "1" };
const namespace = "muppet";

/** A record's attributes, the same on its log record and its span. */
export const attributes = (
	record: WakeRecord,
): Readonly<Record<string, Value>> => {
	const { trigger, session, parent } = record;
	const optional = (
		entries: Readonly<Record<string, Value | undefined>>,
	): Readonly<Record<string, Value>> =>
		Object.fromEntries(
			Object.entries(entries).flatMap(([key, value]) =>
				value === undefined ? [] : [[key, value]],
			),
		);
	return optional({
		"event.name": `muppet.wake.${record.phase}`,
		"muppet.schema": record.v,
		"muppet.system": record.system,
		"muppet.wake.id": record.wake,
		"muppet.wake.phase": record.phase,
		"muppet.wake.parent.id": parent?.wake,
		"muppet.wake.parent.system": parent?.system,
		"muppet.wake.started_at": record.startedAt,
		"muppet.trigger.kind": trigger.kind,
		"muppet.trigger.source": trigger.source,
		"muppet.trigger.name": trigger.name,
		"muppet.trigger.summary": trigger.summary,
		...Object.fromEntries(
			Object.entries(trigger.ids).map(([name, id]) => [
				`muppet.trigger.id.${name}`,
				id,
			]),
		),
		"muppet.herdr.terminal": record.terminal,
		"gen_ai.operation.name": record.operation ?? "invoke_agent",
		"gen_ai.agent.name": record.system,
		"gen_ai.conversation.id": session?.id,
		"session.id": session?.id,
		"gen_ai.provider.name": session?.provider,
		"gen_ai.request.model": session?.model,
		"muppet.agent.kind": session?.agent,
		...(record.phase === "end"
			? {
					"muppet.wake.ended_at": record.endedAt,
					"muppet.wake.duration_ms": record.durationMs,
					"muppet.wake.status": record.status,
					"error.type": record.error?.type,
					"error.message": record.error?.message,
					"muppet.outcome.name": record.outcome.name,
					"muppet.outcome.source": record.outcome.source,
					"muppet.outcome.check": record.outcome.check,
					"muppet.outcome.reported": record.outcome.reported,
					"muppet.outcome.observed": record.outcome.observed,
					"muppet.outcome.summary": record.outcome.summary,
					"muppet.effects": record.effects.map(({ kind, id }) =>
						id === undefined ? kind : `${kind}:${id}`,
					),
					"gen_ai.usage.input_tokens": record.usage?.inputTokens,
					"gen_ai.usage.output_tokens": record.usage?.outputTokens,
					"muppet.usage.cost_usd": record.usage?.costUsd,
					"muppet.usage.turns": record.usage?.turns,
				}
			: {}),
	});
};

const second = 1_000_000_000n;

/** An ISO instant as OpenTelemetry's time: seconds, and nanoseconds within the second. */
const hrTime = (iso: string): HrTime => {
	const nanoseconds = Temporal.Instant.from(iso).epochNanoseconds;
	return [Number(nanoseconds / second), Number(nanoseconds % second)];
};

/** A record's attributes as the SDK takes them. */
const sdkAttributes = (record: WakeRecord): Attributes =>
	Object.fromEntries(
		Object.entries(attributes(record)).map(([key, value]) => [
			key,
			typeof value === "object" ? [...value] : value,
		]),
	);

const severity = (
	record: WakeRecord,
): { readonly text: string; readonly number: SeverityNumber } => {
	if (record.phase !== "end" || record.status === "ok")
		return { text: "INFO", number: SeverityNumber.INFO };
	return record.status === "cancelled"
		? { text: "WARN", number: SeverityNumber.WARN }
		: { text: "ERROR", number: SeverityNumber.ERROR };
};

/** The record in one line, for a person reading the log. */
export const line = (record: WakeRecord): string => {
	const { trigger } = record;
	const why = [trigger.kind, trigger.source, trigger.name]
		.filter((part) => part !== undefined)
		.join(" ");
	return record.phase === "end"
		? `${record.system} wake ${record.wake} ${record.status}: ${record.outcome.name} (${why})`
		: `${record.system} wake ${record.wake} ${record.phase} (${why})`;
};

/** Where the SDK sends what it has batched. */
export type Exporters = {
	readonly logs: LogRecordExporter;
	readonly spans: SpanExporter;
};

const defaultTimeoutMs = 2_000;
const defaultMaxQueued = 500;
const defaultDelayMs = 1_000;

/** OTLP/HTTP exporters to a collector at `endpoint`, e.g. `http://127.0.0.1:4328`: logs to `/v1/logs`, spans to `/v1/traces`. */
export const otlpExporters = ({
	endpoint,
	timeoutMs = defaultTimeoutMs,
}: {
	readonly endpoint: string;
	/** How long the collector has to answer. */
	readonly timeoutMs?: number;
}): Exporters => ({
	logs: new OTLPLogExporter({
		url: `${endpoint}/v1/logs`,
		timeoutMillis: timeoutMs,
	}),
	spans: new OTLPTraceExporter({
		url: `${endpoint}/v1/traces`,
		timeoutMillis: timeoutMs,
	}),
});

/**
 * A sink that hands each record to OpenTelemetry's SDK: a log record for
 * every record, and a span for an ended wake, with the trace and span ids
 * the record already carries. The SDK batches them and sends them through
 * `exporters` (by default OTLP/HTTP to `endpoint`) in the background. The
 * sink resolves at once: nothing waits on the collector, and nothing it does
 * or fails to do is thrown. For a collector that is down, the SDK keeps up to
 * `maxQueued` records while it retries, then drops them.
 */
export const otlpSink = ({
	endpoint,
	resource,
	timeoutMs = defaultTimeoutMs,
	maxQueued = defaultMaxQueued,
	delayMs = defaultDelayMs,
	exporters = otlpExporters({ endpoint, timeoutMs }),
}: {
	readonly endpoint: string;
	readonly resource: Resource;
	/** How long the collector has to answer, and how long a flush may take. */
	readonly timeoutMs?: number;
	/** How many records are kept for a collector that isn't taking them. */
	readonly maxQueued?: number;
	/** How long records wait to be sent together. */
	readonly delayMs?: number;
	/** Replaces the OTLP/HTTP exporters, e.g. with the SDK's in-memory ones in a test. */
	readonly exporters?: Exporters;
}): {
	readonly sink: (record: WakeRecord) => Promise<void>;
	/** Resolves once what is queued has been tried, or the timeout has passed. For a process about to exit, and for tests. */
	readonly flush: () => Promise<void>;
} => {
	const described = resourceFromAttributes({
		"service.name": resource.system,
		"service.namespace": namespace,
		...resource.attributes,
	});
	const batch = {
		maxQueueSize: maxQueued,
		maxExportBatchSize: Math.min(maxQueued, defaultMaxQueued),
		scheduledDelayMillis: delayMs,
		exportTimeoutMillis: timeoutMs,
	};
	const loggers = new LoggerProvider({
		resource: described,
		processors: [
			new BatchLogRecordProcessor({ exporter: exporters.logs, ...batch }),
		],
	});
	// The span takes the ids its record already has, which the wake has
	// handed on to whatever it started, rather than fresh ones.
	let ids: Ended["trace"] | undefined;
	const tracers = new TracerProvider({
		resource: described,
		spanProcessors: [
			new BatchSpanProcessor({ exporter: exporters.spans, ...batch }),
		],
		idGenerator: {
			generateTraceId: () => ids?.traceId ?? "",
			generateSpanId: () => ids?.spanId ?? "",
		},
	});
	const logger = loggers.getLogger(scope.name, scope.version);
	const tracer = tracers.getTracer(scope.name, scope.version);

	const log = (record: WakeRecord): void => {
		const at = hrTime(
			record.phase === "end" ? record.endedAt : record.startedAt,
		);
		const { text, number } = severity(record);
		logger.emit({
			eventName: `muppet.wake.${record.phase}`,
			timestamp: at,
			observedTimestamp: at,
			severityNumber: number,
			severityText: text,
			body: line(record),
			attributes: sdkAttributes(record),
			context: trace.setSpanContext(ROOT_CONTEXT, {
				traceId: record.trace.traceId,
				spanId: record.trace.spanId,
				traceFlags: TraceFlags.SAMPLED,
			}),
		});
	};

	const span = (record: Ended): void => {
		const { traceId, parentSpanId } = record.trace;
		ids = record.trace;
		const started = tracer.startSpan(
			`${record.operation ?? "invoke_agent"} ${record.system}`,
			{
				kind: SpanKind.INTERNAL,
				startTime: hrTime(record.startedAt),
				attributes: sdkAttributes(record),
			},
			parentSpanId === undefined
				? ROOT_CONTEXT
				: trace.setSpanContext(ROOT_CONTEXT, {
						traceId,
						spanId: parentSpanId,
						traceFlags: TraceFlags.SAMPLED,
						isRemote: true,
					}),
		);
		ids = undefined;
		started.setStatus(
			record.status === "ok"
				? { code: SpanStatusCode.OK }
				: {
						code: SpanStatusCode.ERROR,
						message: record.error?.message ?? record.status,
					},
		);
		started.end(hrTime(record.endedAt));
	};

	return {
		sink: async (record) => {
			try {
				log(record);
				if (record.phase === "end") span(record);
			} catch {
				// Telemetry costs the record, never the wake.
			}
		},
		flush: async () => {
			await Promise.all([
				loggers.forceFlush({ timeoutMillis: timeoutMs }),
				tracers.forceFlush({ timeoutMillis: timeoutMs }),
			]).catch(() => undefined);
		},
	};
};
