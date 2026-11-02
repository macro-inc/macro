import { fireAndForget } from '@core/util/fireAndForget';
import { type Attributes, Telemetry } from '@macro-inc/observability';
import { blockingWorkBetween } from './ui-operation';

// This counts live route component owners, including retained hidden panes,
// rather than navigation history entries or serialized restoration snapshots.
const routeViews = new Set<object>();
export function trackRouteView(): () => void {
  if (!Telemetry.config.perfSampled) return () => {};
  const view = {};
  routeViews.add(view);
  return () => routeViews.delete(view);
}

type MemoryPerformance = Performance & {
  measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

/** Coverage is explicit: browser aggregate memory and JS heap are different. */
export async function browserMemoryAttributes(): Promise<Attributes> {
  const browser: MemoryPerformance = performance;
  if (
    globalThis.crossOriginIsolated &&
    browser.measureUserAgentSpecificMemory
  ) {
    try {
      const memory = await browser.measureUserAgentSpecificMemory();
      return {
        'macro.memory.browser.source': 'user_agent_specific',
        'macro.memory.browser.bytes': memory.bytes,
      };
    } catch {
      // The browser can reject the measurement despite exposing the API.
    }
  }
  if (browser.memory)
    return {
      'macro.memory.browser.source': 'js_heap',
      'macro.memory.js_heap.used_bytes': browser.memory.usedJSHeapSize,
      'macro.memory.js_heap.total_bytes': browser.memory.totalJSHeapSize,
      'macro.memory.js_heap.limit_bytes': browser.memory.jsHeapSizeLimit,
    };
  return { 'macro.memory.browser.source': 'unavailable' };
}

/** One visible-tab window per minute; no timer or listeners when unsampled. */
export function startRuntimeResourceSampling(
  readNativeMemory?: () => Attributes | Promise<Attributes>
): () => void {
  if (!Telemetry.config.perfSampled) return () => {};
  let disposed = false;
  let pending = false;
  let generation = 0;
  let start = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule() {
    timer = setTimeout(
      () => fireAndForget(sample(), 'runtime-resources'),
      60_000
    );
  }
  async function sample() {
    if (pending) {
      schedule();
      return;
    }
    pending = true;
    const windowGeneration = generation;
    const end = performance.now();
    const attributes: Attributes = {
      'macro.trace.class': 'perf',
      'runtime.window_ms': end - start,
      'runtime.session_age_ms': end,
      'runtime.route_views.count': routeViews.size,
      'runtime.blocking_work.coverage': 'bounded_recent_entries',
    };
    const work = blockingWorkBetween(start, end);
    const supported =
      typeof PerformanceObserver === 'undefined'
        ? []
        : PerformanceObserver.supportedEntryTypes;
    attributes['runtime.long_task.supported'] = supported.includes('longtask');
    attributes['runtime.long_animation_frame.supported'] = supported.includes(
      'long-animation-frame'
    );
    if (supported.includes('longtask')) {
      attributes['runtime.long_task.count'] = work.longTaskCount;
      attributes['runtime.long_task.ms'] = work.longTaskMs;
    }
    if (supported.includes('long-animation-frame')) {
      attributes['runtime.long_animation_frame.count'] =
        work.longAnimationFrameCount;
      attributes['runtime.long_animation_frame.ms'] = work.longAnimationFrameMs;
      attributes['runtime.long_animation_frame.blocking_ms'] =
        work.longAnimationFrameBlockingMs;
    }
    const timestamp = performance.timeOrigin + end;
    start = end;
    try {
      const [memory, native] = await Promise.all([
        browserMemoryAttributes(),
        readNativeMemory?.(),
      ]);
      if (disposed || generation !== windowGeneration || document.hidden)
        return;
      Telemetry.recordSample(
        'app.runtime.sample',
        { ...attributes, ...memory, ...native },
        timestamp
      );
    } finally {
      pending = false;
      if (!disposed && generation === windowGeneration && !document.hidden)
        schedule();
    }
  }
  function visibilityChanged() {
    generation++;
    clearTimeout(timer);
    if (!document.hidden) {
      start = performance.now();
      schedule();
    }
  }
  function dispose() {
    disposed = true;
    generation++;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', visibilityChanged);
    window.removeEventListener('pagehide', pageHidden);
    window.removeEventListener('pageshow', pageShown);
  }
  function pageHidden(event: PageTransitionEvent) {
    if (!event.persisted) return dispose();
    generation++;
    clearTimeout(timer);
  }
  function pageShown(event: PageTransitionEvent) {
    if (event.persisted) visibilityChanged();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('pagehide', pageHidden);
  window.addEventListener('pageshow', pageShown);
  if (!document.hidden) schedule();
  return dispose;
}
