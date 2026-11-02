import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api';
import {
  ParentBasedSampler,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_TRACE_CLASS, PERF_TRACE_CLASS } from './constants';

/**
 * Keeps every root trace except perf-class roots, which follow the runtime's
 * single per-session decision: a sampled session exports all of its perf
 * traces and an unsampled one none.
 */
class PerfSessionSampler implements Sampler {
  readonly #sampled: boolean;

  constructor(sampled: boolean) {
    this.#sampled = sampled;
  }

  shouldSample(
    _context: Context,
    _traceId: string,
    _name: string,
    _kind: SpanKind,
    attributes: Attributes,
    _links: Link[]
  ): SamplingResult {
    const perf = attributes[ATTR_TRACE_CLASS] === PERF_TRACE_CLASS;
    return {
      decision:
        perf && !this.#sampled
          ? SamplingDecision.NOT_RECORD
          : SamplingDecision.RECORD_AND_SAMPLED,
    };
  }

  toString(): string {
    return `PerfSessionSampler{sampled=${this.#sampled}}`;
  }
}

/** Children follow their parent; roots apply the per-session perf decision. */
export function createPerfSampler(sampled: boolean): Sampler {
  return new ParentBasedSampler({ root: new PerfSessionSampler(sampled) });
}
