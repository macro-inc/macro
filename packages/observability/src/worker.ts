// Cloudflare Workers entry. Importing @microlabs/otel-cf-workers loads the
// `cloudflare:workers` module at module scope, so this stays in its own entry
// (like zone.ts) and must only be imported from code that runs in workerd.
import {
	BatchTraceSpanProcessor,
	instrument,
	instrumentDO,
	OTLPExporter,
	type TraceConfig,
} from "@microlabs/otel-cf-workers";
import type { Span } from "@opentelemetry/api";
import { ATTR_DEPLOYMENT_ENVIRONMENT, ATTR_USER_ID } from "./constants";

export type { TraceConfig };
export { instrument, instrumentDO };

export interface WorkerTraceConfigOptions {
	serviceName: string;
	environment: string;
	/** OTLP/HTTP traces endpoint. Spans are not exported when unset. */
	tracesUrl?: string;
	/** Extra headers for the export request (e.g. an intake API key). */
	tracesHeaders?: Record<string, string>;
	/** Read the current user id; called once per span when it starts. */
	getUserId?: () => string | undefined;
}

/**
 * Trace config for otel-cf-workers' `instrument()`/`instrumentDO()`.
 *
 * `instrument()` registers the global tracer provider, an AsyncLocalStorage
 * context manager, and the W3C propagator. `Telemetry.span()` resolves its
 * tracer through the global OpenTelemetry API, so spans parent and export
 * correctly with no `tracingProvider` passed to `Telemetry.init`. Export and
 * flushing are owned by otel-cf-workers (via `ctx.waitUntil`), not
 * `Telemetry.flush`.
 *
 * otel-cf-workers' service config has no environment field, so unlike the
 * web provider — which sets `deployment.environment` on the resource —
 * environment (and user id) are stamped onto every span here.
 */
export function createWorkerTraceConfig(
	options: WorkerTraceConfigOptions,
): TraceConfig {
	return {
		service: { name: options.serviceName },
		spanProcessors: [
			{
				onStart: (span: Span) => {
					span.setAttribute(ATTR_DEPLOYMENT_ENVIRONMENT, options.environment);
					const userId = options.getUserId?.();
					if (userId !== undefined) span.setAttribute(ATTR_USER_ID, userId);
				},
				onEnd: () => {},
				forceFlush: () => Promise.resolve(),
				shutdown: () => Promise.resolve(),
			},
			...(options.tracesUrl
				? [
						new BatchTraceSpanProcessor(
							new OTLPExporter({
								url: options.tracesUrl,
								headers: options.tracesHeaders,
							}),
						),
					]
				: []),
		],
	};
}
