import {
  type Context,
  context,
  createContextKey,
  ROOT_CONTEXT,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { Attributes, TelemetryInitConfig } from './config';
import {
  ATTR_TRACE_CLASS,
  INSTRUMENTATION_SCOPE_NAME,
  PERF_TRACE_CLASS,
} from './constants';
import { suppressUserId } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import { type Span, SpanImpl, type TraceContext } from './span';

/** Set on a perf span's context so every descendant carries the class. */
const PERF_TRACE_KEY = createContextKey('@macro-inc/observability/perf-trace');

export class Tracing {
  #provider: TelemetryTracingProvider | undefined;
  #propagationEnabled = false;
  #enablement: Promise<void> | undefined;

  init(
    config: TelemetryInitConfig,
    resource: Resource,
    getUserId: () => string | undefined,
    perfSampled: boolean
  ): void {
    this.#propagationEnabled = false;
    this.#enablement = this.#enablePropagation(config);
    this.#provider = config.tracingProvider?.(resource, getUserId, perfSampled);
  }

  captureContext(): TraceContext {
    const parent = context.active();
    return { run: (operation) => context.with(parent, operation) };
  }

  span(name: string, startTime?: number): Span {
    return this.#startSpan(
      name,
      context.active(),
      undefined,
      undefined,
      startTime
    );
  }

  /** Starts a detached root span tree with user enrichment suppressed. */
  anonymousSpan(name: string): Span {
    return this.#startSpan(name, suppressUserId(ROOT_CONTEXT));
  }

  clientSpan(name: string): Span {
    return this.#startSpan(name, context.active(), SpanKind.CLIENT);
  }

  /** Starts a span the sampler may drop as a whole performance trace. */
  perfSpan(name: string, startTime?: number): Span {
    return this.#startSpan(
      name,
      context.active(),
      undefined,
      {
        [ATTR_TRACE_CLASS]: PERF_TRACE_CLASS,
      },
      startTime
    );
  }

  /** Export a timestamped measurement without retaining a long-lived span. */
  recordSample(name: string, attributes: Attributes, timestamp: number): void {
    const span = trace
      .getTracer(INSTRUMENTATION_SCOPE_NAME)
      .startSpan(name, { startTime: timestamp, attributes }, ROOT_CONTEXT);
    // Historical samples must win over live onStart enrichment.
    span.setAttributes(attributes);
    span.end(timestamp);
  }

  async flush(): Promise<void> {
    await this.#enablement;
    await this.#provider?.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.#provider?.shutdown();
    this.#provider = undefined;
  }

  #startSpan(
    name: string,
    parent: Context,
    kind?: SpanKind,
    attributes?: Attributes,
    startTime?: number
  ): Span {
    // Descendants of a perf root (phases, HTTP client spans) are tagged too,
    // so span queries can select a perf trace's spans without trace queries.
    const perf =
      attributes?.[ATTR_TRACE_CLASS] === PERF_TRACE_CLASS ||
      parent.getValue(PERF_TRACE_KEY) === true;
    const otelSpan = trace.getTracer(INSTRUMENTATION_SCOPE_NAME).startSpan(
      name,
      {
        kind,
        attributes: perf
          ? { ...attributes, [ATTR_TRACE_CLASS]: PERF_TRACE_CLASS }
          : attributes,
        startTime,
      },
      parent
    );
    const provider = this.#provider;
    return new SpanImpl(
      otelSpan,
      trace.setSpan(
        perf ? parent.setValue(PERF_TRACE_KEY, true) : parent,
        otelSpan
      ),
      (childName, childParent) => this.#startSpan(childName, childParent),
      () => this.#propagationEnabled,
      () =>
        trace.setSpanContext(
          parent,
          provider?.resolveSpanContext?.(otelSpan) ?? otelSpan.spanContext()
        )
    );
  }
  async #enablePropagation(config: TelemetryInitConfig): Promise<void> {
    try {
      const [enabled] = await Promise.all([config.enabled(), config.startup]);
      this.#propagationEnabled = enabled;
    } catch {
      this.#propagationEnabled = false;
    }
  }
}
