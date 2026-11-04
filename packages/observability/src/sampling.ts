import {
  type Context,
  createContextKey,
  INVALID_SPAN_CONTEXT,
  type SpanContext,
  TraceFlags,
  trace,
} from '@opentelemetry/api';
import {
  type ReadableSpan,
  type Sampler,
  SamplingDecision,
  type SamplingResult,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SAMPLING_CLASS, ATTR_SAMPLING_RATE } from './constants';

/**
 * Applications name their sampling classes by augmenting this interface:
 *
 * ```ts
 * declare module '@macro-inc/observability' {
 *   interface TelemetryRegister {
 *     samplingClass: 'always' | 'perf';
 *   }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: augmented by applications.
export interface TelemetryRegister {}

/** A sampling class registered by the application, else any string. */
export type SamplingClass = TelemetryRegister extends {
  samplingClass: infer Registered extends string;
}
  ? Registered
  : string;

/** A uniform position in [0, 1) for a string: FNV-1a, then MurmurHash3's finalizer. */
function bucket(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 2 ** 32;
}

/**
 * Whether a sampling key keeps a class. The same key always makes the same
 * decision for a class, and its decisions for different classes are
 * independent.
 */
export function keepsClass(
  key: string,
  samplingClass: string,
  rate: number
): boolean {
  return bucket(key + samplingClass) < rate;
}

/** The spans one started span is placed among, once its classes are decided. */
type Placement =
  | { readonly exported: false }
  | {
      readonly exported: true;
      /** The span whose trace this one is exported in. */
      readonly root: SpanRecord;
      readonly samplingClass: string | undefined;
    };

const DROPPED: Placement = { exported: false };

/** What sampling needs to know about a span started through `Tracing`. */
export interface SpanRecord {
  /** The span this one was started under, in the same OpenTelemetry trace. */
  readonly parent: SpanRecord | undefined;
  /** A phase shares its parent's trace and is dropped with it. */
  readonly phase: boolean;
  readonly requested: string | undefined;
  spanContext: SpanContext;
  placement?: Placement;
  /** Set on a root that left its parent's trace after the span started. */
  traceId?: string;
}

/** Marks a context whose next span is already known to be dropped. */
const DROPPED_KEY = createContextKey('@macro-inc/observability/dropped');

function randomTraceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  );
}

/**
 * Per-class sampling for one runtime. Each class is kept or dropped once, at
 * enablement, so spans started before then are placed when they are exported.
 *
 * A span joins its parent's trace if that trace is exported. Otherwise a phase
 * is dropped with it, and any other span starts its own trace when its own
 * class is kept (an unclassed span always is) and is dropped when it is not.
 */
export class TraceSampling implements Sampler {
  #rates: Readonly<Record<string, number>> = {};
  #kept: ReadonlyMap<string, boolean> | undefined;
  readonly #records = new WeakMap<object, SpanRecord>();
  #resolveDecided: () => void = () => {};
  /** Settles once every class is decided. */
  readonly decided = new Promise<void>((resolve) => {
    this.#resolveDecided = resolve;
  });

  configure(rates: Readonly<Record<string, number>>): void {
    this.#rates = rates;
  }

  /** Decide every configured class once. */
  decide(keep: (samplingClass: string, rate: number) => boolean): void {
    if (this.#kept) return;
    this.#kept = new Map(
      Object.entries(this.#rates).map(([samplingClass, rate]) => [
        samplingClass,
        keep(samplingClass, rate),
      ])
    );
    this.#resolveDecided();
  }

  /** Unclassed and unconfigured classes are kept; undefined until decided. */
  kept(samplingClass: string | undefined): boolean | undefined {
    if (samplingClass === undefined || !(samplingClass in this.#rates))
      return true;
    return this.#kept?.get(samplingClass);
  }

  rate(samplingClass: string): number {
    return this.#rates[samplingClass] ?? 1;
  }

  /**
   * Register a span about to start under `parent`. Returns its record and the
   * context to start it in: its parent's exported trace, a new trace when it
   * leaves a dropped one, or a context marked dropped.
   */
  start(
    parent: Context,
    phase: boolean,
    requested: string | undefined
  ): { record: SpanRecord; context: Context } {
    const parentSpan = trace.getSpan(parent);
    const parentRecord = parentSpan && this.#records.get(parentSpan);
    const parentPlacement = parentRecord && this.#place(parentRecord);
    let context = parent.deleteValue(DROPPED_KEY);
    let recordParent = parentRecord;
    if (parentRecord && parentPlacement?.exported) {
      context = trace.setSpanContext(
        context,
        this.#exportedContext(parentRecord, parentPlacement)
      );
    } else if (parentPlacement && !phase) {
      context = trace.deleteSpan(context);
      recordParent = undefined;
    }
    const record: SpanRecord = {
      parent: recordParent,
      phase,
      requested,
      spanContext: INVALID_SPAN_CONTEXT,
    };
    if (this.#place(record)?.exported === false)
      context = context.setValue(DROPPED_KEY, true);
    return { record, context };
  }

  /** Associate a started span with its record. */
  started(span: object, record: SpanRecord, spanContext: SpanContext): void {
    record.spanContext = spanContext;
    this.#records.set(span, record);
  }

  shouldSample(context: Context): SamplingResult {
    return {
      decision:
        context.getValue(DROPPED_KEY) === true
          ? SamplingDecision.NOT_RECORD
          : SamplingDecision.RECORD_AND_SAMPLED,
    };
  }

  toString(): string {
    return 'TraceSampling';
  }

  /** The context to propagate for a span: unsampled when it is dropped. */
  spanContext(span: { spanContext(): SpanContext }): SpanContext {
    const original = span.spanContext();
    const record = this.#records.get(span);
    const placement = record && this.#place(record);
    if (!record || !placement) return original;
    if (!placement.exported)
      return { ...original, traceFlags: TraceFlags.NONE };
    return this.#exportedContext(record, placement);
  }

  /**
   * The span to export, or undefined when it is dropped. Call only after the
   * classes are decided. A span is tagged with the class it asked for, else
   * the one its parent was tagged with.
   */
  exported(span: ReadableSpan): ReadableSpan | undefined {
    const record = this.#records.get(span);
    if (!record) return span;
    const placement = this.#place(record);
    if (!placement?.exported) return undefined;
    const samplingClass = placement.samplingClass;
    const spanContext = this.#exportedContext(record, placement);
    if (samplingClass === undefined && spanContext === record.spanContext)
      return span;
    const tags =
      samplingClass === undefined
        ? {}
        : {
            [ATTR_SAMPLING_CLASS]: samplingClass,
            [ATTR_SAMPLING_RATE]: this.rate(samplingClass),
          };
    let parentSpanContext = span.parentSpanContext;
    if (placement.root === record && record.parent)
      parentSpanContext = undefined;
    else if (parentSpanContext && spanContext !== record.spanContext)
      parentSpanContext = {
        ...parentSpanContext,
        traceId: spanContext.traceId,
      };
    return {
      name: span.name,
      kind: span.kind,
      spanContext: () => spanContext,
      parentSpanContext,
      startTime: span.startTime,
      endTime: span.endTime,
      status: span.status,
      attributes: { ...span.attributes, ...tags },
      links: span.links,
      events: span.events,
      duration: span.duration,
      ended: span.ended,
      resource: span.resource,
      instrumentationScope: span.instrumentationScope,
      droppedAttributesCount: span.droppedAttributesCount,
      droppedEventsCount: span.droppedEventsCount,
      droppedLinksCount: span.droppedLinksCount,
    };
  }

  /** Undefined while a class it depends on is undecided. */
  #place(record: SpanRecord): Placement | undefined {
    if (record.placement) return record.placement;
    let placement: Placement | undefined;
    if (record.parent) {
      const parent = this.#place(record.parent);
      if (!parent) return undefined;
      if (parent.exported)
        placement = {
          exported: true,
          root: parent.root,
          samplingClass: record.requested ?? parent.samplingClass,
        };
      else if (record.phase) placement = DROPPED;
    }
    if (!placement) {
      const kept = this.kept(record.requested);
      if (kept === undefined) return undefined;
      placement = kept
        ? { exported: true, root: record, samplingClass: record.requested }
        : DROPPED;
    }
    record.placement = placement;
    return placement;
  }

  /** A root that left its parent's trace moves its spans to a new trace id. */
  #exportedContext(
    record: SpanRecord,
    placement: Placement & { exported: true }
  ): SpanContext {
    const root = placement.root;
    if (!root.parent) return record.spanContext;
    root.traceId ??= randomTraceId();
    if (record.spanContext.traceId === root.traceId) return record.spanContext;
    return {
      ...record.spanContext,
      traceId: root.traceId,
      traceFlags: TraceFlags.SAMPLED,
    };
  }
}
