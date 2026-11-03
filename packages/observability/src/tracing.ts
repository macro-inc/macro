import {
  type Context,
  context,
  type Span as OtelSpan,
  ROOT_CONTEXT,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { Attributes, TelemetryInitConfig } from './config';
import { INSTRUMENTATION_SCOPE_NAME } from './constants';
import { suppressUserId } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import type { SamplingClass, TraceSampling } from './sampling';
import { type Span, SpanImpl, type TraceContext } from './span';

export interface SpanOptions {
  /**
   * The class whose sampling decision keeps this span when it starts outside
   * an exported trace. Without one it is always kept.
   */
  sampling?: SamplingClass;
  /** `client` for an outbound request. Defaults to `internal`. */
  kind?: 'internal' | 'client';
  /** Start time as Unix time in milliseconds, for a phase that already began. */
  startTime?: number;
  attributes?: Attributes;
}

interface StartOptions extends SpanOptions {
  /** A phase of its parent: always in its parent's trace, dropped with it. */
  phase?: boolean;
}

export class Tracing {
  #provider: TelemetryTracingProvider | undefined;
  #sampling: TraceSampling | undefined;
  #propagationEnabled = false;
  #enablement: Promise<void> | undefined;

  init(
    config: TelemetryInitConfig<string>,
    resource: Resource,
    getUserId: () => string | undefined,
    sampling: TraceSampling
  ): void {
    this.#sampling = sampling;
    this.#propagationEnabled = false;
    this.#enablement = this.#enablePropagation(config, sampling);
    this.#provider = config.tracingProvider?.(resource, getUserId, sampling);
  }

  captureContext(): TraceContext {
    const parent = context.active();
    return { run: (operation) => context.with(parent, operation) };
  }

  span(name: string, options: SpanOptions = {}): Span {
    return this.#startSpan(name, context.active(), options);
  }

  /** Starts a detached root span tree with user enrichment suppressed. */
  anonymousSpan(name: string): Span {
    return this.#startSpan(name, suppressUserId(ROOT_CONTEXT), {});
  }

  /** Export a timestamped measurement without retaining a long-lived span. */
  recordSample(
    name: string,
    attributes: Attributes,
    timestamp: number,
    sampling?: SamplingClass
  ): void {
    const { otelSpan } = this.#startOtelSpan(name, ROOT_CONTEXT, {
      sampling,
      attributes,
      startTime: timestamp,
    });
    // Historical samples must win over live onStart enrichment.
    otelSpan.setAttributes(attributes);
    otelSpan.end(timestamp);
  }

  async flush(): Promise<void> {
    await this.#enablement;
    await this.#provider?.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.#provider?.shutdown();
    this.#provider = undefined;
  }

  #startOtelSpan(
    name: string,
    parent: Context,
    options: StartOptions
  ): { otelSpan: OtelSpan; parent: Context } {
    const started = this.#sampling?.start(
      parent,
      options.phase ?? false,
      options.sampling
    );
    const startParent = started?.context ?? parent;
    const otelSpan = trace.getTracer(INSTRUMENTATION_SCOPE_NAME).startSpan(
      name,
      {
        kind: options.kind === 'client' ? SpanKind.CLIENT : undefined,
        attributes: options.attributes,
        startTime: options.startTime,
      },
      startParent
    );
    if (started)
      this.#sampling?.started(otelSpan, started.record, otelSpan.spanContext());
    return { otelSpan, parent: startParent };
  }

  #startSpan(name: string, parent: Context, options: StartOptions): Span {
    const { otelSpan, parent: startParent } = this.#startOtelSpan(
      name,
      parent,
      options
    );
    const sampling = this.#sampling;
    return new SpanImpl(
      otelSpan,
      trace.setSpan(startParent, otelSpan),
      (childName, childParent) =>
        this.#startSpan(childName, childParent, { phase: true }),
      () => this.#propagationEnabled,
      () =>
        trace.setSpanContext(
          startParent,
          sampling?.spanContext(otelSpan) ?? otelSpan.spanContext()
        )
    );
  }

  async #enablePropagation(
    config: TelemetryInitConfig<string>,
    sampling: TraceSampling
  ): Promise<void> {
    try {
      const [enabled] = await Promise.all([config.enabled(), config.startup]);
      // Spans started before enablement propagate once they are placed.
      await sampling.decided;
      this.#propagationEnabled = enabled;
    } catch {
      this.#propagationEnabled = false;
    }
  }
}
