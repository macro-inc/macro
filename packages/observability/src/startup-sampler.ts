import {
  type Attributes,
  type Context,
  type Link,
  type Span,
  type SpanContext,
  type SpanKind,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import {
  type ReadableSpan,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import type { TelemetryStartupOptions } from './config';
import { createPerfSampler } from './sampler';

/** Capture early recordings while retaining the normal session's sampling decision. */
export class StartupSampler implements Sampler {
  readonly ready: Promise<void>;
  readonly #normal: Sampler;
  readonly #normalDecisions = new WeakMap<object, boolean>();
  #recording: boolean | undefined;

  constructor(perfSampled: boolean, startup: Promise<TelemetryStartupOptions>) {
    this.#normal = createPerfSampler(perfSampled);
    // Failure selects normal sampling; enablement independently fails closed.
    this.ready = startup.then(
      (settings) => {
        this.#recording = settings.recording;
      },
      () => {
        this.#recording = false;
      }
    );
  }

  #normallySampled(
    parent: Context,
    traceId: string,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    links: Link[]
  ): boolean {
    const parentSpan = trace.getSpan(parent);
    const inherited = parentSpan && this.#normalDecisions.get(parentSpan);
    return (
      inherited ??
      this.#normal.shouldSample(parent, traceId, name, kind, attributes, links)
        .decision === SamplingDecision.RECORD_AND_SAMPLED
    );
  }

  shouldSample(
    parent: Context,
    traceId: string,
    name: string,
    kind: SpanKind,
    attributes: Attributes,
    links: Link[]
  ): SamplingResult {
    const keep =
      this.#recording !== false ||
      this.#normallySampled(parent, traceId, name, kind, attributes, links);
    return {
      decision: keep
        ? SamplingDecision.RECORD_AND_SAMPLED
        : SamplingDecision.NOT_RECORD,
    };
  }

  remember(span: ReadableSpan, parent: Context): void {
    this.#normalDecisions.set(
      span,
      this.#normallySampled(
        parent,
        span.spanContext().traceId,
        span.name,
        span.kind,
        span.attributes,
        span.links
      )
    );
  }

  exports(span: ReadableSpan): boolean {
    return this.#recording === true || this.#normalDecisions.get(span) === true;
  }

  spanContext(span: Span): SpanContext {
    const original = span.spanContext();
    if (
      this.#recording === false &&
      this.#normalDecisions.get(span) === false
    ) {
      return { ...original, traceFlags: TraceFlags.NONE };
    }
    return original;
  }

  toString(): string {
    return 'StartupSampler';
  }
}
