import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventTimingCursor,
  initializeUiOperationTelemetry,
  readEventTimings,
  setActiveRoute,
  startUiOperation,
} from './ui-operation';

const { spans } = vi.hoisted(() => ({
  spans: [] as {
    name: string;
    attrs: Record<string, unknown>;
    ends: number;
    events: string[];
  }[],
}));
vi.mock('@macro-inc/observability', () => ({
  NOOP_SPAN: {},
  Telemetry: {
    perfSpan: (name: string) => {
      const record = {
        name,
        attrs: {} as Record<string, unknown>,
        ends: 0,
        events: [] as string[],
      };
      spans.push(record);
      return {
        setAttr: (key: string, value: unknown) => {
          record.attrs[key] = value;
        },
        event: (name: string) => record.events.push(name),
        run: <T>(work: () => T) => work(),
        end: () => {
          record.ends++;
        },
      };
    },
  },
}));

describe('UI operation timing', () => {
  let now = 100;
  let cleanup: () => void;
  let frames: Map<number, FrameRequestCallback>;
  let records: PerformanceEntry[];
  let disconnected: number;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 100;
    frames = new Map();
    records = [];
    disconnected = 0;
    spans.length = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = [
          'event',
          'longtask',
          'long-animation-frame',
        ];
        observe() {}
        takeRecords() {
          const result = records;
          records = [];
          return result;
        }
        disconnect() {
          disconnected++;
        }
      }
    );
    cleanup = initializeUiOperationTelemetry();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function frame() {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(now));
  }

  function event(timeStamp: number) {
    const click = new Event('click');
    Object.defineProperty(click, 'timeStamp', { value: timeStamp });
    return click;
  }

  it('includes input queueing and correlates browser timing without reporting exact paint', () => {
    const operation = startUiOperation('database.cell.editor.open', {
      event: event(20),
    });
    operation.run(() => {
      now = 120;
    });
    operation.afterPaint();
    now = 140;
    frame();
    expect(spans[0].ends).toBe(0);
    records.push(
      {
        entryType: 'longtask',
        name: 'secret URL',
        startTime: 10,
        duration: 100,
      } as PerformanceEntry,
      {
        entryType: 'event',
        name: 'click',
        startTime: 20,
        duration: 140,
        processingStart: 90,
        processingEnd: 120,
      } as unknown as PerformanceEntry
    );
    now = 160;
    frame();
    expect(spans[0].attrs).toMatchObject({
      'ui.event_to_handler_ms': 80,
      'ui.work_to_ready_ms': 20,
      'ui.input_to_paint_opportunity_ms': 140,
      'ui.ready_to_paint_opportunity_ms': 40,
      'ui.paint_measurement': 'two_animation_frames_approximation',
      'ui.long_task_count': 1,
      'ui.long_task_overlap_ms': 90,
      'ui.event_input_delay_ms': 70,
      'ui.event_processing_ms': 30,
      'ui.event_duration_ms': 140,
    });
    expect(JSON.stringify(spans)).not.toContain('secret URL');
    operation.cancel();
    expect(spans[0].ends).toBe(1);
  });

  it('tags each root with its kind and, except navigations, the current route', () => {
    setActiveRoute('channel');
    startUiOperation('database.cell.commit').cancel();
    startUiOperation('navigation', { kind: 'navigation' }).cancel();
    startUiOperation('view.email', {
      kind: 'view',
      attributes: { 'route.id': 'email' },
    }).cancel();
    expect(spans.map((span) => span.attrs['flow.kind'])).toEqual([
      'interaction',
      'navigation',
      'view',
    ]);
    expect(spans.map((span) => span.attrs['route.id'])).toEqual([
      'channel',
      undefined,
      'email',
    ]);
    expect(spans[0].attrs).toMatchObject({
      'ui.outcome': 'cancelled',
      'ui.long_task_count': 0,
      'ui.long_animation_frame_count': 0,
    });
    expect(spans[0].attrs['ui.elapsed_ms']).toEqual(expect.any(Number));
  });

  it('ends hidden operations and cancels frames without claiming a paint', () => {
    const operation = startUiOperation('database.cell.editor.open');
    operation.afterPaint();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spans[0].attrs['ui.outcome']).toBe('hidden');
    expect(spans[0].attrs['ui.paint_measurement']).toBeUndefined();
    expect(frames.size).toBe(0);
  });

  it('bounds active operations and times out abandoned operations', () => {
    for (let index = 0; index < 40; index++)
      startUiOperation('database.query.refresh');
    expect(spans).toHaveLength(32);
    vi.advanceTimersByTime(30_000);
    expect(
      spans.every(
        (span) => span.ends === 1 && span.attrs['ui.outcome'] === 'timeout'
      )
    ).toBe(true);
    startUiOperation('database.query.refresh').finish();
    expect(spans).toHaveLength(33);
  });

  it('normalizes epoch timestamps and rejects invalid timestamps', () => {
    startUiOperation('database.cell.commit', {
      event: event(performance.timeOrigin + 50),
    }).finish();
    startUiOperation('database.cell.commit', { event: event(500) }).finish();
    expect(spans[0].attrs['ui.event_to_handler_ms']).toBe(50);
    expect(spans[1].attrs['ui.event_to_handler_ms']).toBeUndefined();
  });

  it('reads event timings after a cursor and reports what the bounded buffer dropped', () => {
    const keydown = (start: number) =>
      ({
        entryType: 'event',
        name: 'keydown',
        startTime: start,
        duration: 40,
        processingStart: start + 5,
        processingEnd: start + 25,
        interactionId: start,
      }) as unknown as PerformanceEntry;
    records.push(keydown(1));
    const cursor = eventTimingCursor();
    records.push(keydown(10), {
      entryType: 'longtask',
      name: 'self',
      startTime: 12,
      duration: 80,
    } as PerformanceEntry);
    const read = readEventTimings(cursor);
    expect(read).toMatchObject({
      dropped: 0,
      supported: true,
      thresholdMs: 16,
    });
    expect(read.entries).toEqual([
      {
        name: 'keydown',
        start: 10,
        inputDelayMs: 5,
        processingMs: 20,
        durationMs: 40,
        interactionId: 10,
      },
    ]);

    for (let start = 100; start < 400; start++) records.push(keydown(start));
    const late = readEventTimings(read.cursor);
    expect(late.dropped).toBe(100);
    expect(late.entries).toHaveLength(200);
    expect(readEventTimings(late.cursor).entries).toEqual([]);
  });

  it('cleans up observers once and works without PerformanceObserver support', () => {
    expect(initializeUiOperationTelemetry()).toBe(cleanup);
    startUiOperation('database.cell.editor.open');
    cleanup();
    expect(disconnected).toBe(3);
    expect(spans[0].attrs['ui.outcome']).toBe('cancelled');
    vi.stubGlobal('PerformanceObserver', undefined);
    cleanup = initializeUiOperationTelemetry();
    startUiOperation('database.cell.editor.open').finish();
    expect(spans[1].attrs['ui.performance_entry_types']).toBe('');
  });
});
