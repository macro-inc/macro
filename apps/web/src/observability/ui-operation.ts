import { Telemetry } from '@macro-inc/observability';

type Outcome = 'success' | 'error' | 'cancelled' | 'timeout' | 'hidden';
type Attributes = Record<string, string | number | boolean>;

export interface UiOperation {
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
  kind: string;
  start: number;
  duration: number;
  name: string;
  processingStart?: number;
  processingEnd?: number;
  blockingDuration?: number;
};

const MAX_ENTRIES = 200;
const MAX_OPERATIONS = 32;
const TIMEOUT_MS = 30_000;
const timings: Timing[] = [];
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
    };
    timings.push({
      kind: entry.entryType,
      start: entry.startTime,
      duration: entry.duration,
      // Event names are browser-defined, never selector/text/URL attributes.
      name: entry.entryType === 'event' ? entry.name : '',
      processingStart: timing.processingStart,
      processingEnd: timing.processingEnd,
      blockingDuration: timing.blockingDuration,
    });
  }
  if (timings.length > MAX_ENTRIES)
    timings.splice(0, timings.length - MAX_ENTRIES);
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
          ...(type === 'event' ? { durationThreshold: 16 } : {}),
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
  options: { event?: Event; attributes?: Attributes } = {}
): UiOperation {
  if (
    typeof window === 'undefined' ||
    !disposeObservers ||
    active.size >= MAX_OPERATIONS
  )
    return noop;
  const started = performance.now();
  const input = inputTime(options.event, started);
  const eventType = options.event?.type;
  const span = Telemetry.span(name);
  span.setAttr('ui.operation', name);
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
    for (const kind of ['longtask', 'long-animation-frame']) {
      const entries = overlap.filter((entry) => entry.kind === kind);
      const prefix =
        kind === 'longtask' ? 'ui.long_task' : 'ui.long_animation_frame';
      span.setAttr(`${prefix}_count`, entries.length);
      span.setAttr(
        `${prefix}_overlap_ms`,
        entries.reduce(
          (total, entry) =>
            total +
            Math.max(
              0,
              Math.min(end, entry.start + entry.duration) -
                Math.max(input ?? started, entry.start)
            ),
          0
        )
      );
      if (kind === 'long-animation-frame')
        span.setAttr(
          'ui.long_animation_frame_blocking_ms',
          entries.reduce(
            (total, entry) => total + (entry.blockingDuration ?? 0),
            0
          )
        );
    }
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
    active.delete(operation);
    span.end();
  }
  const operation: UiOperation = {
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
