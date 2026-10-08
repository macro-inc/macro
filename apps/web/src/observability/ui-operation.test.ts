import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initializeUiOperationTelemetry,
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
  Telemetry: {
    span: (name: string) => {
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
