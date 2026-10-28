import {
  type Context,
  context,
  ROOT_CONTEXT,
  SpanKind,
  trace,
} from '@opentelemetry/api';
import type { Resource } from '@opentelemetry/resources';
import type { Attributes, TelemetryInitConfig } from './config';
import { INSTRUMENTATION_SCOPE_NAME } from './constants';
import { suppressUserId } from './privacy';
import type { TelemetryTracingProvider } from './provider';
import { type Span, SpanImpl } from './span';

export class Tracing {
  #provider: TelemetryTracingProvider | undefined;

  init(
    config: TelemetryInitConfig,
    resource: Resource,
    getUserId: () => string | undefined
  ): void {
    this.#provider = config.tracingProvider?.(resource, getUserId);
  }

  span(name: string): Span {
    return this.#startSpan(name, context.active());
  }

  /** Starts a detached root span tree with user enrichment suppressed. */
  anonymousSpan(name: string): Span {
    return this.#startSpan(name, suppressUserId(ROOT_CONTEXT));
  }

  clientSpan(name: string): Span {
    return this.#startSpan(name, context.active(), SpanKind.CLIENT);
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
    await this.#provider?.forceFlush();
  }

  async shutdown(): Promise<void> {
    await this.#provider?.shutdown();
    this.#provider = undefined;
  }

  #startSpan(name: string, parent: Context, kind?: SpanKind): Span {
    const otelSpan = trace
      .getTracer(INSTRUMENTATION_SCOPE_NAME)
      .startSpan(name, kind === undefined ? undefined : { kind }, parent);
    return new SpanImpl(
      otelSpan,
      trace.setSpan(parent, otelSpan),
      (childName, childParent) => this.#startSpan(childName, childParent)
    );
  }
}
