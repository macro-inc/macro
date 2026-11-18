import { Telemetry } from '@macro-inc/observability';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  browserMemoryAttributes,
  startRuntimeResourceSampling,
  trackRouteView,
} from './runtime-resources';
import { blockingWorkBetween } from './ui-operation';

vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    config: { sampled: vi.fn(() => true) },
    recordSample: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock('./ui-operation', () => ({
  blockingWorkBetween: vi.fn(() => ({
    longTaskCount: 2,
    longTaskMs: 120,
    longAnimationFrameCount: 1,
    longAnimationFrameMs: 100,
    longAnimationFrameBlockingMs: 40,
  })),
}));
let dispose: (() => void) | undefined;
let releases: (() => void)[] = [];
function visible(value: boolean) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(!value);
  document.dispatchEvent(new Event('visibilitychange'));
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.mocked(Telemetry.recordSample).mockClear();
  vi.mocked(blockingWorkBetween).mockClear();
  vi.mocked(Telemetry.config.sampled).mockReturnValue(true);
  vi.stubGlobal('PerformanceObserver', {
    supportedEntryTypes: ['longtask', 'long-animation-frame'],
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('crossOriginIsolated', false);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  for (const release of releases) release();
  releases = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('installs no work at all in unsampled sessions', async () => {
  vi.mocked(Telemetry.config.sampled).mockReturnValue(false);
  const listener = vi.spyOn(document, 'addEventListener');
  const read = vi.fn();
  dispose = startRuntimeResourceSampling(read);
  releases.push(trackRouteView());
  expect(listener).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read).not.toHaveBeenCalled();
  expect(blockingWorkBetween).not.toHaveBeenCalled();
  expect(Telemetry.recordSample).not.toHaveBeenCalled();
});
it('reports visible windows, live route owners, session age and existing native fields', async () => {
  releases.push(trackRouteView(), trackRouteView());
  const read = vi.fn(() => ({
    'macro.memory.web_content.footprint_bytes': 1024,
  }));
  dispose = startRuntimeResourceSampling(read);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(blockingWorkBetween).toHaveBeenLastCalledWith(0, 60_000);
  expect(Telemetry.recordSample).toHaveBeenLastCalledWith(
    'app.runtime.sample',
    expect.objectContaining({
      'runtime.window_ms': 60_000,
      'runtime.session_age_ms': 60_000,
      'runtime.route_views.count': 2,
      'runtime.long_task.ms': 120,
      'runtime.long_animation_frame.blocking_ms': 40,
      'macro.memory.web_content.footprint_bytes': 1024,
    }),
    performance.timeOrigin + 60_000,
    'perf'
  );
  releases[0]();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(Telemetry.recordSample).toHaveBeenLastCalledWith(
    'app.runtime.sample',
    expect.objectContaining({
      'runtime.route_views.count': 1,
      'runtime.session_age_ms': 120_000,
    }),
    expect.any(Number),
    'perf'
  );
  expect(read).toHaveBeenCalledTimes(2);
});
it('does no work hidden and starts a fresh visible window on return', async () => {
  dispose = startRuntimeResourceSampling();
  await vi.advanceTimersByTimeAsync(30_000);
  visible(false);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(blockingWorkBetween).not.toHaveBeenCalled();
  visible(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(blockingWorkBetween).toHaveBeenLastCalledWith(150_000, 210_000);
});
it('does not publish a stale asynchronous memory read after hide and resume', async () => {
  let finish!: (value: Record<string, number>) => void;
  const read = vi.fn(
    () =>
      new Promise<Record<string, number>>((resolve) => {
        finish = resolve;
      })
  );
  dispose = startRuntimeResourceSampling(read);
  await vi.advanceTimersByTimeAsync(60_000);
  visible(false);
  visible(true);
  finish({ 'macro.memory.web_content.footprint_bytes': 1 });
  await Promise.resolve();
  await Promise.resolve();
  expect(Telemetry.recordSample).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});
it('stops timers and ignores pending reads after disposal', async () => {
  let finish!: (value: Record<string, number>) => void;
  dispose = startRuntimeResourceSampling(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await vi.advanceTimersByTimeAsync(60_000);
  dispose();
  finish({});
  await Promise.resolve();
  await Promise.resolve();
  visible(true);
  expect(vi.getTimerCount()).toBe(0);
  expect(Telemetry.recordSample).not.toHaveBeenCalled();
});
it('omits unavailable observer totals instead of reporting false zero CPU', async () => {
  vi.stubGlobal('PerformanceObserver', undefined);
  dispose = startRuntimeResourceSampling();
  await vi.advanceTimersByTimeAsync(60_000);
  const attrs = vi.mocked(Telemetry.recordSample).mock.calls[0][1];
  expect(attrs['runtime.long_task.supported']).toBe(false);
  expect(attrs).not.toHaveProperty('runtime.long_task.ms');
});
it('reads aggregate memory only when isolated, with an explicit source', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
    configurable: true,
    value: vi.fn(async () => ({ bytes: 2048 })),
  });
  expect(await browserMemoryAttributes()).toEqual({
    'macro.memory.browser.source': 'user_agent_specific',
    'macro.memory.browser.bytes': 2048,
  });
});
it('falls back to Chromium heap when aggregate memory rejects', async () => {
  vi.stubGlobal('crossOriginIsolated', true);
  Object.defineProperty(performance, 'measureUserAgentSpecificMemory', {
    configurable: true,
    value: vi.fn(async () => {
      throw new Error('denied');
    }),
  });
  Object.defineProperty(performance, 'memory', {
    configurable: true,
    value: { usedJSHeapSize: 10, totalJSHeapSize: 20, jsHeapSizeLimit: 30 },
  });
  expect(await browserMemoryAttributes()).toEqual({
    'macro.memory.browser.source': 'js_heap',
    'macro.memory.js_heap.used_bytes': 10,
    'macro.memory.js_heap.total_bytes': 20,
    'macro.memory.js_heap.limit_bytes': 30,
  });
});

it('pauses a cached page and resumes a fresh visible window', async () => {
  dispose = startRuntimeResourceSampling();
  await vi.advanceTimersByTimeAsync(10_000);
  window.dispatchEvent(
    new PageTransitionEvent('pagehide', { persisted: true })
  );
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(
    new PageTransitionEvent('pageshow', { persisted: true })
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(blockingWorkBetween).toHaveBeenLastCalledWith(70_000, 130_000);
});
it('does not overlap a hung measurement after a visibility restart', async () => {
  const read = vi.fn(() => new Promise<Record<string, number>>(() => {}));
  dispose = startRuntimeResourceSampling(read);
  await vi.advanceTimersByTimeAsync(60_000);
  visible(false);
  visible(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(read).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(1);
});
