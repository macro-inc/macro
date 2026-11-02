import { NOOP_SPAN, Telemetry } from '@macro-inc/observability';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startTypingBurstTelemetry } from './typing-burst';
import { initializeUiOperationTelemetry } from './ui-operation';

vi.mock('@macro-inc/observability', () => {
  const span = {
    setAttr: vi.fn(),
    end: vi.fn(),
    event: vi.fn(),
    run: (work: () => unknown) => work(),
  };
  return {
    NOOP_SPAN: span,
    Telemetry: {
      config: { perfSampled: true },
      perfSpan: vi.fn(() => ({ ...span, setAttr: vi.fn(), end: vi.fn() })),
    },
  };
});
let dispose: (() => void) | undefined;
let disposeOperations: (() => void) | undefined;
let input: HTMLTextAreaElement;
let records: PerformanceEntry[];
let observerCount: number;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
  records = [];
  observerCount = 0;
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes = [
        'event',
        'longtask',
        'long-animation-frame',
      ];
      constructor() {
        observerCount++;
      }
      observe() {}
      takeRecords() {
        const pending = records;
        records = [];
        return pending;
      }
      disconnect() {}
    }
  );
  vi.spyOn(Telemetry.config, 'perfSampled', 'get').mockReturnValue(true);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  input = document.createElement('textarea');
  input.dataset.inputSurface = 'command-search';
  document.body.append(input);
  input.focus();
  vi.runOnlyPendingTimers();
  disposeOperations = initializeUiOperationTelemetry();
});
afterEach(() => {
  dispose?.();
  disposeOperations?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function edit(target = input) {
  const key = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
  Object.defineProperty(key, 'timeStamp', { value: performance.now() });
  target.dispatchEvent(key);
  const event = new InputEvent('beforeinput', {
    inputType: 'insertText',
    data: 'private text',
    bubbles: true,
  });
  Object.defineProperty(event, 'timeStamp', { value: performance.now() });
  target.dispatchEvent(event);
  return performance.now();
}

it('installs no listeners or timers in unsampled sessions', () => {
  vi.spyOn(Telemetry.config, 'perfSampled', 'get').mockReturnValue(false);
  const listen = vi.spyOn(document, 'addEventListener');
  dispose = startTypingBurstTelemetry();
  expect(listen).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  edit();
  expect(Telemetry.perfSpan).not.toHaveBeenCalled();
});
function timing(
  start: number,
  id: number,
  duration = 32,
  name = 'keydown',
  delay = 2,
  processing = 3
) {
  const entry = {
    entryType: 'event',
    name,
    startTime: start,
    duration,
    processingStart: start + delay,
    processingEnd: start + delay + processing,
    interactionId: id,
    toJSON: () => ({}),
  };
  records.push(entry);
}
function spanAttributes() {
  const span = vi.mocked(Telemetry.perfSpan).mock.results.at(-1)!.value;
  return Object.fromEntries(vi.mocked(span.setAttr).mock.calls);
}

it('reads one content-free cursor window per burst without frame sampling', () => {
  const frame = vi.spyOn(window, 'requestAnimationFrame');
  dispose = startTypingBurstTelemetry();
  for (let i = 0; i < 200; i++) {
    vi.advanceTimersByTime(20);
    timing(edit(), i + 1, 16 + i, 'keydown', i % 5, i % 7);
  }
  expect(Telemetry.perfSpan).toHaveBeenCalledTimes(1);
  const span = vi.mocked(Telemetry.perfSpan).mock.results[0].value;
  expect(span.end).not.toHaveBeenCalled();
  vi.advanceTimersByTime(750);
  expect(span.end).toHaveBeenCalledOnce();
  expect(spanAttributes()).toMatchObject({
    'typing.input_count': 200,
    'typing.surface': 'command-search',
    'typing.event_timing_supported': true,
    'typing.event_timing_threshold_ms': 16,
    'typing.event_timing_dropped_timings': 0,
    'typing.event_timing_entry_count': 200,
    'typing.event_timing_interaction_count': 200,
    'typing.event_timing_coverage': 'thresholded_window',
    'typing.event_duration_p50_ms': 115,
    'typing.event_duration_p95_ms': 205,
    'typing.event_input_delay_p95_ms': 4,
    'typing.event_processing_p95_ms': 6,
  });
  expect(JSON.stringify(vi.mocked(span.setAttr).mock.calls)).not.toContain(
    'private text'
  );
  expect(frame).not.toHaveBeenCalled();
  expect(observerCount).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
  edit();
  expect(Telemetry.perfSpan).toHaveBeenCalledTimes(2);
});

it('reports retained interactions and dropped timings when the shared buffer overflows', () => {
  dispose = startTypingBurstTelemetry();
  for (let i = 0; i < 1000; i++) {
    vi.advanceTimersByTime(1);
    timing(edit(), i + 1);
  }
  vi.advanceTimersByTime(750);
  expect(spanAttributes()).toMatchObject({
    'typing.input_count': 1000,
    'typing.event_timing_interaction_count': 200,
    'typing.event_timing_dropped_timings': 800,
    'typing.event_timing_coverage': 'buffer_truncated',
  });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not interpret dropped non-event timings as a missing input count', () => {
  dispose = startTypingBurstTelemetry();
  vi.advanceTimersByTime(100);
  const start = edit();
  for (let i = 0; i < 201; i++)
    records.push({
      entryType: 'longtask',
      name: '',
      startTime: start,
      duration: 50,
      toJSON: () => ({}),
    });
  timing(start, 1);
  vi.advanceTimersByTime(750);
  expect(spanAttributes()).toMatchObject({
    'typing.input_count': 1,
    'typing.event_timing_interaction_count': 1,
    'typing.event_timing_dropped_timings': 2,
    'typing.event_timing_coverage': 'buffer_truncated',
  });
});

it('reads the cursor and cancels the quiet boundary at the shared continuous-burst timeout', () => {
  dispose = startTypingBurstTelemetry();
  for (let i = 0; i < 50; i++) {
    timing(edit(), i + 1);
    vi.advanceTimersByTime(600);
  }
  expect(Telemetry.perfSpan).toHaveBeenCalledTimes(1);
  expect(spanAttributes()).toMatchObject({
    'ui.outcome': 'timeout',
    'typing.input_count': 50,
    'typing.event_timing_interaction_count': 50,
    'typing.event_timing_dropped_timings': 0,
  });
  expect(
    vi.mocked(Telemetry.perfSpan).mock.results[0].value.end
  ).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('deduplicates keyboard interactions, excludes pointer/other windows and counts unassigned edits', () => {
  dispose = startTypingBurstTelemetry();
  vi.advanceTimersByTime(100);
  const first = edit();
  timing(first, 1, 48, 'keydown', 4, 10);
  timing(first + 0.1, 1, 64, 'keypress', 1, 20);
  timing(first + 20, 1, 32, 'keyup', 2, 1);
  timing(first + 1, 0, 32, 'beforeinput');
  timing(first + 2, 0, 32, 'input');
  timing(first - 10, 9, 999);
  timing(first + 2000, 10, 999);
  timing(first + 10, 3, 999, 'click');
  vi.advanceTimersByTime(40);
  timing(edit(), 2, 24, 'keydown', 8, 5);
  vi.advanceTimersByTime(750);
  expect(spanAttributes()).toMatchObject({
    'typing.input_count': 2,
    'typing.event_timing_entry_count': 6,
    'typing.event_timing_interaction_count': 2,
    'typing.event_timing_unattributed_entry_count': 2,
    'typing.event_timing_aggregation': 'max_per_interaction',
    'typing.event_duration_p50_ms': 24,
    'typing.event_duration_p95_ms': 64,
    'typing.event_input_delay_p50_ms': 4,
    'typing.event_input_delay_p95_ms': 8,
    'typing.event_processing_p50_ms': 5,
    'typing.event_processing_p95_ms': 20,
  });
});

it('does not invent zero-latency samples when supported events are not delivered', () => {
  dispose = startTypingBurstTelemetry();
  edit();
  vi.advanceTimersByTime(750);
  const attrs = spanAttributes();
  expect(attrs).toMatchObject({
    'typing.event_timing_supported': true,
    'typing.event_timing_interaction_count': 0,
    'typing.event_timing_coverage': 'thresholded_window',
    'typing.event_timing_delivery': 'available_at_finish',
  });
  expect(attrs).not.toHaveProperty('typing.event_duration_p95_ms');
});

it('reports unsupported browsers without percentiles', () => {
  disposeOperations?.();
  vi.stubGlobal(
    'PerformanceObserver',
    class {
      static supportedEntryTypes: string[] = [];
    }
  );
  disposeOperations = initializeUiOperationTelemetry();
  dispose = startTypingBurstTelemetry();
  edit();
  vi.advanceTimersByTime(750);
  const attrs = spanAttributes();
  expect(attrs).toMatchObject({
    'typing.event_timing_supported': false,
    'typing.event_timing_interaction_count': 0,
    'typing.event_timing_coverage': 'unsupported',
  });
  expect(attrs).not.toHaveProperty('typing.event_duration_p95_ms');
});
it('ends on hide and disposal and ignores unmarked or read-only fields', () => {
  dispose = startTypingBurstTelemetry();
  input.removeAttribute('data-input-surface');
  edit();
  input.dataset.inputSurface = 'command-search';
  input.readOnly = true;
  edit();
  expect(Telemetry.perfSpan).not.toHaveBeenCalled();
  input.readOnly = false;
  edit();
  const span = vi.mocked(Telemetry.perfSpan).mock.results[0].value;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  expect(span.setAttr).toHaveBeenCalledWith('ui.outcome', 'hidden');
  expect(span.end).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  edit();
  expect(Telemetry.perfSpan).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  edit();
  const second = vi.mocked(Telemetry.perfSpan).mock.results[1].value;
  dispose();
  expect(second.end).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  expect(NOOP_SPAN.end).not.toHaveBeenCalled();
});
it('finishes the previous field before starting another owner', () => {
  dispose = startTypingBurstTelemetry();
  edit();
  const other = document.createElement('textarea');
  other.dataset.inputSurface = 'grid-cell';
  document.body.append(other);
  edit(other);
  expect(Telemetry.perfSpan).toHaveBeenCalledTimes(2);
  const first = vi.mocked(Telemetry.perfSpan).mock.results[0].value;
  const second = vi.mocked(Telemetry.perfSpan).mock.results[1].value;
  expect(first.end).toHaveBeenCalledOnce();
  expect(second.end).not.toHaveBeenCalled();
});

it('drops an unmatched key when its field blurs before the next edit', () => {
  dispose = startTypingBurstTelemetry();
  vi.advanceTimersByTime(100);
  const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
  Object.defineProperty(key, 'timeStamp', { value: performance.now() });
  input.dispatchEvent(key);
  input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  vi.advanceTimersByTime(100);
  const paste = new InputEvent('beforeinput', {
    inputType: 'insertFromPaste',
    bubbles: true,
  });
  Object.defineProperty(paste, 'timeStamp', { value: performance.now() });
  input.dispatchEvent(paste);
  const span = vi.mocked(Telemetry.perfSpan).mock.results[0].value;
  expect(span.setAttr).toHaveBeenCalledWith('ui.input_type', 'beforeinput');
});
