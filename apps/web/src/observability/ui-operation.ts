import { NOOP_SPAN, type Span, Telemetry } from '@macro-inc/observability';
import type { SamplingClass } from './sampling';

export type UiOperationOutcome =
  | 'success'
  | 'error'
  | 'cancelled'
  | 'timeout'
  | 'hidden';
type Outcome = UiOperationOutcome;
type Attributes = Record<string, string | number | boolean>;

/**
 * What a perf root measures, recorded as `flow.kind` so dashboards can rank
 * each kind separately. `boot` and `navigation` take their `route.id` from the
 * first view that joins them, not from the route they started on.
 */
export type FlowKind = 'boot' | 'navigation' | 'view' | 'interaction';

let activeRoute: string | undefined;

/** Record the route of the view that opened most recently, for later roots. */
export function setActiveRoute(route: string): void {
  activeRoute = route;
}

/** The route of the view that opened most recently. */
export function currentRoute(): string | undefined {
  return activeRoute;
}

export interface UiOperationOptions {
  /** Defaults to `interaction`. */
  kind?: FlowKind;
  event?: Event;
  attributes?: Attributes;
  /**
   * When it started, in `performance.now()` time, for an operation that began
   * before code could observe it (0 is the page's navigation start).
   */
  startTime?: number;
  /** Add final attributes or child spans before the span ends. */
  onFinish?: (span: Span, outcome: Outcome, end: number) => void;
  /** The sampling class of the trace it starts. Defaults to `perf`. */
  sampling?: SamplingClass;
}

export interface UiOperation {
  /** The operation's root span, for child phases. */
  readonly span: Span;
  /** Whether it has finished, including by timeout or hiding the page. */
  readonly ended: boolean;
  /** Runs application work in this operation's trace context. */
  run<T>(work: () => T): T;
  /** Static phase names only; never include user content. */
  mark(phase: string): void;
  finish(outcome?: Outcome): void;
  /** Call after updating the UI; this measures a paint opportunity, not pixels. */
  afterPaint(): void;
  cancel(): void;
}

type Timing = {
  /** Position in everything collected so far; survives buffer trimming. */
  sequence: number;
  kind: string;
  start: number;
  duration: number;
  name: string;
  processingStart?: number;
  processingEnd?: number;
  blockingDuration?: number;
  interactionId?: number;
};

const MAX_ENTRIES = 200;
const MAX_OPERATIONS = 32;
const TIMEOUT_MS = 30_000;
const timings: Timing[] = [];
let collected = 0;
// Event Timing only reports events at or above this duration.
const EVENT_TIMING_THRESHOLD_MS = 16;
const active = new Set<UiOperation>();
let observers: PerformanceObserver[] = [];
let supported: string[] = [];
let disposeObservers: (() => void) | undefined;

function collect(entries: PerformanceEntry[]) {
  for (const entry of entries) {
    const timing = entry as PerformanceEntry & {
      processingStart?: number;
      processingEnd?: number;
      blockingDuration?: number;
      interactionId?: number;
    };
    timings.push({
      sequence: collected++,
      kind: entry.entryType,
      start: entry.startTime,
      duration: entry.duration,
      // Event names are browser-defined, never selector/text/URL attributes.
      name: entry.entryType === 'event' ? entry.name : '',
      processingStart: timing.processingStart,
      processingEnd: timing.processingEnd,
      blockingDuration: timing.blockingDuration,
      interactionId: timing.interactionId,
    });
  }
  if (timings.length > MAX_ENTRIES)
    timings.splice(0, timings.length - MAX_ENTRIES);
}

export interface BlockingWork {
  longTaskCount: number;
  /** Long-task time inside the window. */
  longTaskMs: number;
  longAnimationFrameCount: number;
  /** Long-animation-frame time inside the window. */
  longAnimationFrameMs: number;
  /** Blocking time the browser attributed to those frames. */
  longAnimationFrameBlockingMs: number;
}

function measureBlockingWork(
  start: number,
  end: number,
  entries: readonly Timing[]
): BlockingWork {
  const inWindow = (entry: Timing) =>
    Math.max(
      0,
      Math.min(end, entry.start + entry.duration) - Math.max(start, entry.start)
    );
  const work: BlockingWork = {
    longTaskCount: 0,
    longTaskMs: 0,
    longAnimationFrameCount: 0,
    longAnimationFrameMs: 0,
    longAnimationFrameBlockingMs: 0,
  };
  for (const entry of entries) {
    if (entry.start >= end || entry.start + entry.duration <= start) continue;
    if (entry.kind === 'longtask') {
      work.longTaskCount++;
      work.longTaskMs += inWindow(entry);
    } else if (entry.kind === 'long-animation-frame') {
      work.longAnimationFrameCount++;
      work.longAnimationFrameMs += inWindow(entry);
      work.longAnimationFrameBlockingMs += entry.blockingDuration ?? 0;
    }
  }
  return work;
}

/**
 * Long tasks and long animation frames between `start` and `end`
 * (`performance.now()` time) from the app's shared observer, for samplers
 * that must not install their own. The observer keeps a bounded recent
 * buffer, so windows older than the last few hundred entries undercount.
 */
export function blockingWorkBetween(start: number, end: number): BlockingWork {
  for (const observer of observers) collect(observer.takeRecords());
  return measureBlockingWork(start, end, timings);
}

export interface EventTimingEntry {
  /** Browser event type, such as `keydown`; never targets or content. */
  name: string;
  start: number;
  inputDelayMs: number;
  processingMs: number;
  durationMs: number;
  interactionId: number | undefined;
}

export interface EventTimingRead {
  entries: EventTimingEntry[];
  /** Pass to the next read to continue after these entries. */
  cursor: number;
  /** Buffered timings (of any kind) discarded before this read reached them. */
  dropped: number;
  supported: boolean;
  /** Events shorter than this are never reported by the browser. */
  thresholdMs: number;
}

/** A cursor at the end of the shared buffer, to read only later events. */
export function eventTimingCursor(): number {
  for (const observer of observers) collect(observer.takeRecords());
  return collected;
}

/**
 * Event Timing entries collected since `cursor` by the app's shared observer,
 * for owners that summarize interactions (counts, percentiles) without their
 * own observer or per-event spans. Read often enough to keep `dropped` at 0.
 */
export function readEventTimings(cursor: number): EventTimingRead {
  for (const observer of observers) collect(observer.takeRecords());
  const oldest = timings[0]?.sequence ?? collected;
  const entries: EventTimingEntry[] = [];
  for (const timing of timings) {
    if (timing.sequence < cursor || timing.kind !== 'event') continue;
    entries.push({
      name: timing.name,
      start: timing.start,
      inputDelayMs: (timing.processingStart ?? timing.start) - timing.start,
      processingMs:
        (timing.processingEnd ?? timing.start) -
        (timing.processingStart ?? timing.start),
      durationMs: timing.duration,
      interactionId: timing.interactionId,
    });
  }
  return {
    entries,
    cursor: collected,
    dropped: Math.max(0, oldest - cursor),
    supported: supported.includes('event'),
    thresholdMs: EVENT_TIMING_THRESHOLD_MS,
  };
}

/** One bounded observer per supported entry type for the whole application. */
export function initializeUiOperationTelemetry(): () => void {
  if (disposeObservers) return disposeObservers;
  if (typeof window === 'undefined') return () => {};
  if (typeof PerformanceObserver !== 'undefined') {
    for (const type of ['event', 'longtask', 'long-animation-frame']) {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
      const observer = new PerformanceObserver((list) =>
        collect(list.getEntries())
      );
      try {
        observer.observe({
          type,
          buffered: true,
          ...(type === 'event'
            ? { durationThreshold: EVENT_TIMING_THRESHOLD_MS }
            : {}),
        });
        observers.push(observer);
        supported.push(type);
      } catch {
        observer.disconnect();
      }
    }
  }
  const hide = () => {
    if (document.visibilityState === 'hidden') {
      for (const operation of [...active]) operation.finish('hidden');
    }
  };
  const leave = () => {
    for (const operation of [...active]) operation.cancel();
  };
  document.addEventListener('visibilitychange', hide);
  window.addEventListener('pagehide', leave);
  let disposed = false;
  disposeObservers = () => {
    if (disposed) return;
    disposed = true;
    leave();
    for (const observer of observers) observer.disconnect();
    observers = [];
    supported = [];
    timings.length = 0;
    document.removeEventListener('visibilitychange', hide);
    window.removeEventListener('pagehide', leave);
    disposeObservers = undefined;
  };
  return disposeObservers;
}

/** Normalize legacy epoch timestamps, rejecting missing/future timestamps. */
function inputTime(event: Event | undefined, now: number): number | undefined {
  if (!event || !Number.isFinite(event.timeStamp) || event.timeStamp <= 0)
    return;
  const timestamp =
    event.timeStamp > performance.timeOrigin
      ? event.timeStamp - performance.timeOrigin
      : event.timeStamp;
  if (timestamp >= 0 && timestamp <= now) return timestamp;
}

const noop: UiOperation = {
  span: NOOP_SPAN,
  ended: true,
  run: (work) => work(),
  mark: () => {},
  finish: () => {},
  afterPaint: () => {},
  cancel: () => {},
};

/**
 * Names and attributes must be static categories/bounded counts, never cell
 * contents, prompts, SQL, DOM selectors or labels. Span duration starts at the
 * handler; input-to-ready/paint attributes also include pre-handler queueing.
 * Long-task/frame times describe overlapping browser work, not causal CPU time.
 */
export function startUiOperation(
  name: string,
  options: UiOperationOptions = {}
): UiOperation {
  if (
    typeof window === 'undefined' ||
    !disposeObservers ||
    active.size >= MAX_OPERATIONS
  )
    return noop;
  const started = options.startTime ?? performance.now();
  const input = inputTime(options.event, started);
  const eventType = options.event?.type;
  const span = Telemetry.span(name, {
    sampling: options.sampling ?? 'perf',
    startTime:
      options.startTime === undefined
        ? undefined
        : performance.timeOrigin + options.startTime,
  });
  const kind = options.kind ?? 'interaction';
  span.setAttr('ui.operation', name);
  span.setAttr('flow.kind', kind);
  // A navigation's route is the view it opens, which joins it later.
  if (kind !== 'boot' && kind !== 'navigation' && activeRoute !== undefined)
    span.setAttr('route.id', activeRoute);
  span.setAttr('ui.visibility', document.visibilityState);
  span.setAttr('ui.performance_entry_types', supported.join(','));
  for (const [key, value] of Object.entries(options.attributes ?? {}))
    span.setAttr(key, value);
  if (input !== undefined) {
    // Includes earlier handlers in this dispatch; Event Timing below isolates
    // the browser's actual input queue delay when that API is available.
    span.setAttr('ui.event_to_handler_ms', started - input);
    span.setAttr('ui.input_type', eventType ?? 'unknown');
  }
  let ended = false;
  let frame: number | undefined;
  let ready: number | undefined;
  const timeout = window.setTimeout(() => finish('timeout'), TIMEOUT_MS);

  function finish(outcome: Outcome = 'success') {
    if (ended) return;
    ended = true;
    window.clearTimeout(timeout);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    const end = performance.now();
    for (const observer of observers) collect(observer.takeRecords());
    const overlap = timings.filter(
      (entry) =>
        entry.start < end && entry.start + entry.duration > (input ?? started)
    );
    const work = measureBlockingWork(input ?? started, end, overlap);
    span.setAttr('ui.long_task_count', work.longTaskCount);
    span.setAttr('ui.long_task_overlap_ms', work.longTaskMs);
    span.setAttr('ui.long_animation_frame_count', work.longAnimationFrameCount);
    span.setAttr(
      'ui.long_animation_frame_overlap_ms',
      work.longAnimationFrameMs
    );
    span.setAttr(
      'ui.long_animation_frame_blocking_ms',
      work.longAnimationFrameBlockingMs
    );
    const event =
      input === undefined
        ? undefined
        : overlap.find(
            (entry) =>
              entry.kind === 'event' &&
              entry.name === eventType &&
              Math.abs(entry.start - input) < 1
          );
    span.setAttr('ui.event_timing_matched', event !== undefined);
    if (
      event?.processingStart !== undefined &&
      event.processingEnd !== undefined
    ) {
      span.setAttr(
        'ui.event_input_delay_ms',
        event.processingStart - event.start
      );
      span.setAttr(
        'ui.event_processing_ms',
        event.processingEnd - event.processingStart
      );
      span.setAttr('ui.event_duration_ms', event.duration);
    }
    span.setAttr('ui.outcome', outcome);
    span.setAttr('ui.elapsed_ms', end - started);
    if (ready !== undefined && outcome === 'success') {
      span.setAttr(
        'ui.paint_measurement',
        'two_animation_frames_approximation'
      );
      span.setAttr('ui.ready_to_paint_opportunity_ms', end - ready);
      if (input !== undefined)
        span.setAttr('ui.input_to_paint_opportunity_ms', end - input);
    }
    options.onFinish?.(span, outcome, end);
    active.delete(operation);
    span.end();
  }
  const operation: UiOperation = {
    span,
    get ended() {
      return ended;
    },
    run: (work) => span.run(work),
    mark: (phase) => {
      if (!ended)
        span.event(phase, { 'ui.elapsed_ms': performance.now() - started });
    },
    finish,
    afterPaint: () => {
      if (ended || ready !== undefined) return;
      ready = performance.now();
      span.setAttr('ui.work_to_ready_ms', ready - started);
      if (input !== undefined)
        span.setAttr('ui.input_to_ready_ms', ready - input);
      if (document.visibilityState === 'hidden') return finish('hidden');
      if (typeof window.requestAnimationFrame !== 'function')
        return finish('cancelled');
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => finish());
      });
    },
    cancel: () => finish('cancelled'),
  };
  active.add(operation);
  return operation;
}
