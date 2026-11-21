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
  /** Long animation frames: when rendering, and style and layout, began. */
  renderStart?: number;
  styleAndLayoutStart?: number;
  /** Long animation frames: forced style and layout across all scripts. */
  forcedStyleAndLayoutMs?: number;
  /** Long animation frames: the longest scripts, sanitized. */
  scripts?: ScriptTiming[];
};

/** The fields of a `PerformanceScriptTiming` kept, already sanitized. */
type ScriptTiming = {
  start: number;
  duration: number;
  invoker: string;
  invokerType: string;
  sourceURL: string;
  sourceFunctionName: string;
  sourceCharPosition: number;
  forcedStyleAndLayoutDuration: number;
};

/** As the browser reports it; older Chrome builds lack some fields. */
type LongAnimationFrameEntry = PerformanceEntry & {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: readonly {
    startTime: number;
    duration: number;
    invoker?: string;
    invokerType?: string;
    sourceURL?: string;
    sourceFunctionName?: string;
    sourceCharPosition?: number;
    forcedStyleAndLayoutDuration?: number;
  }[];
};

const MAX_ENTRIES = 200;
/** Scripts reported per operation. */
const MAX_SCRIPTS = 3;
/**
 * Scripts kept per long frame, more than are reported so a frame that
 * straddles an operation's start or end still has the scripts inside the
 * operation's window. Chrome lists only scripts of 5 ms or more.
 */
const MAX_FRAME_SCRIPTS = 10;
const MAX_ATTRIBUTION_LENGTH = 200;
/**
 * How long a finished operation waits before reading long frames. Chrome
 * queues a frame's `long-animation-frame` entry after the frame is
 * presented, 5-46 ms after it ends (measured), which is later than the two
 * animation frames `afterPaint` waits; without this the frame holding the
 * operation's own work is missing. The span keeps its real end time.
 */
const ENTRY_DELAY_MS = 150;
const MAX_OPERATIONS = 32;
const TIMEOUT_MS = 30_000;
const timings: Timing[] = [];
let collected = 0;
// Event Timing only reports events at or above this duration.
const EVENT_TIMING_THRESHOLD_MS = 16;
const active = new Set<UiOperation>();
/** Finished operations waiting for late entries, flushed on hide. */
const reporting = new Set<() => void>();
let observers: PerformanceObserver[] = [];
let supported: string[] = [];
let disposeObservers: (() => void) | undefined;

/**
 * The longest scripts of a long frame, already reduced to what a span may
 * carry so the buffer holds no query strings, ids or `data:` payloads, and
 * the frame's total forced layout.
 */
function frameScripts(entry: LongAnimationFrameEntry) {
  let forced = 0;
  for (const script of entry.scripts ?? [])
    forced += script.forcedStyleAndLayoutDuration ?? 0;
  const scripts = [...(entry.scripts ?? [])]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, MAX_FRAME_SCRIPTS)
    .map(
      (script): ScriptTiming => ({
        start: script.startTime,
        duration: script.duration,
        invoker: scriptInvoker(script.invoker ?? ''),
        invokerType: (script.invokerType ?? '').slice(0, 40),
        sourceURL: scriptSource(script.sourceURL ?? ''),
        sourceFunctionName: (script.sourceFunctionName ?? '').slice(
          0,
          MAX_ATTRIBUTION_LENGTH
        ),
        sourceCharPosition: script.sourceCharPosition ?? -1,
        forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? 0,
      })
    );
  return { scripts, forced };
}

function collect(entries: PerformanceEntry[]) {
  for (const entry of entries) {
    const timing = entry as PerformanceEntry & {
      processingStart?: number;
      processingEnd?: number;
      blockingDuration?: number;
      interactionId?: number;
    };
    const frame =
      entry.entryType === 'long-animation-frame'
        ? (entry as LongAnimationFrameEntry)
        : undefined;
    const attribution = frame ? frameScripts(frame) : undefined;
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
      renderStart: frame?.renderStart,
      styleAndLayoutStart: frame?.styleAndLayoutStart,
      forcedStyleAndLayoutMs: attribution?.forced,
      scripts: attribution?.scripts,
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

const SCRIPT_PATH = /\.[cm]?[jt]sx?$/;
const URL_SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** Schemes whose URLs never have `//` but are still not invoker names. */
const URL_SCHEMES = new Set(['blob', 'data', 'javascript', 'file', 'about']);

/**
 * A script URL without query or fragment. Code that runs from the page
 * itself (inline handlers, injected scripts such as Tauri's IPC) is
 * `<origin>/(document)`, so routes never reach the span; other schemes
 * (`blob:`, `data:`, extensions) keep only the scheme.
 */
export function scriptSource(url: string): string {
  if (!url) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '(unparsed)';
  }
  if (!['http:', 'https:', 'tauri:'].includes(parsed.protocol))
    return parsed.protocol;
  const path = SCRIPT_PATH.test(parsed.pathname)
    ? parsed.pathname
    : '/(document)';
  return `${parsed.protocol}//${parsed.host}${path}`.slice(
    0,
    MAX_ATTRIBUTION_LENGTH
  );
}

/**
 * What called a script, such as `DIV.onkeydown` or `Response.json.then`.
 * Element ids and `[src=...]` are dropped; a script URL is a source.
 */
export function scriptInvoker(invoker: string): string {
  const scheme = URL_SCHEME.exec(invoker)?.[1]?.toLowerCase();
  if (scheme && (URL_SCHEMES.has(scheme) || invoker.includes('//')))
    return scriptSource(invoker);
  // `TAG#id.onclick` or `TAG[src=url].onload`: keep the tag and the event,
  // whatever the id or attribute holds (dots, brackets).
  if (/[#[]/.test(invoker.slice(1))) {
    const tag = /^#?[A-Za-z0-9-]*/.exec(invoker)?.[0] ?? '';
    const event = /\.on[a-z]+$/.exec(invoker)?.[0] ?? '';
    return `${tag}${event}`;
  }
  return invoker.slice(0, MAX_ATTRIBUTION_LENGTH);
}

/**
 * The scripts that held the main thread longest in the long frames
 * overlapping `[start, end]`, with the longest frame's render and layout
 * time, as `ui.long_animation_frame_*` attributes.
 */
function frameAttribution(
  start: number,
  end: number,
  entries: readonly Timing[]
): Attributes {
  const attributes: Attributes = {};
  let forced = 0;
  let longest: Timing | undefined;
  const scripts: ScriptTiming[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'long-animation-frame') continue;
    if (entry.start >= end || entry.start + entry.duration <= start) continue;
    forced += entry.forcedStyleAndLayoutMs ?? 0;
    if (!longest || entry.duration > longest.duration) longest = entry;
    for (const script of entry.scripts ?? [])
      if (script.start < end && script.start + script.duration > start)
        scripts.push(script);
  }
  if (!longest) return attributes;
  const frameEnd = longest.start + longest.duration;
  attributes['ui.long_animation_frame_max_ms'] = longest.duration;
  if (longest.renderStart)
    attributes['ui.long_animation_frame_max_render_ms'] =
      frameEnd - longest.renderStart;
  if (longest.styleAndLayoutStart)
    attributes['ui.long_animation_frame_max_style_layout_ms'] =
      frameEnd - longest.styleAndLayoutStart;
  attributes['ui.long_animation_frame_forced_style_layout_ms'] = forced;
  scripts.sort((a, b) => b.duration - a.duration);
  const top = scripts.slice(0, MAX_SCRIPTS);
  attributes['ui.long_animation_frame_script_count'] = top.length;
  top.forEach((script, index) => {
    const prefix = `ui.long_animation_frame_script_${index + 1}`;
    attributes[`${prefix}.invoker`] = script.invoker;
    attributes[`${prefix}.invoker_type`] = script.invokerType;
    attributes[`${prefix}.source_url`] = script.sourceURL;
    attributes[`${prefix}.source_function`] = script.sourceFunctionName;
    attributes[`${prefix}.source_char_position`] = script.sourceCharPosition;
    attributes[`${prefix}.duration_ms`] = script.duration;
    attributes[`${prefix}.forced_style_layout_ms`] =
      script.forcedStyleAndLayoutDuration;
  });
  return attributes;
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
  // A hidden page may never run the delayed reports; send what is known.
  const flush = () => {
    for (const report of [...reporting]) report();
  };
  const hide = () => {
    if (document.visibilityState === 'hidden') {
      for (const operation of [...active]) operation.finish('hidden');
      flush();
    }
  };
  const leave = () => {
    for (const operation of [...active]) operation.cancel();
    flush();
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
 * Browser timing is read, and the span ended at its finish time, a short
 * while after `finish`, when late long-frame entries have arrived.
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

  /** Browser timing for the operation, once late entries have arrived. */
  function report(end: number) {
    for (const observer of observers) collect(observer.takeRecords());
    const from = input ?? started;
    const overlap = timings.filter(
      (entry) => entry.start < end && entry.start + entry.duration > from
    );
    const work = measureBlockingWork(from, end, overlap);
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
    for (const [key, value] of Object.entries(
      frameAttribution(from, end, overlap)
    ))
      span.setAttr(key, value);
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
    // Same clock as the start: OpenTelemetry offsets a `performance.now()`
    // end onto the wall-clock start it took itself, while an explicit start
    // is already epoch time from the time origin.
    span.end(
      options.startTime === undefined ? end : performance.timeOrigin + end
    );
  }

  function finish(outcome: Outcome = 'success') {
    if (ended) return;
    ended = true;
    window.clearTimeout(timeout);
    if (frame !== undefined) window.cancelAnimationFrame(frame);
    const end = performance.now();
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
    const send = () => {
      if (!reporting.delete(send)) return;
      window.clearTimeout(delay);
      report(end);
    };
    reporting.add(send);
    const delay = window.setTimeout(send, ENTRY_DELAY_MS);
    // Abandoned operations have no last frame worth waiting for.
    if (
      outcome === 'cancelled' ||
      outcome === 'timeout' ||
      document.visibilityState === 'hidden'
    )
      send();
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
