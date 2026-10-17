import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createBufferedThread,
  THREAD_SWITCH_DEADLINE_MS,
} from './buffered-thread';

const operations = vi.hoisted(
  () => [] as { threadId: unknown; outcome?: string }[]
);
vi.mock('@app/observability/ui-operation', () => ({
  startUiOperation: (
    _name: string,
    options: { attributes: Record<string, unknown> }
  ) => {
    const operation: { threadId: unknown; outcome?: string } = {
      threadId: options.attributes['email.thread_id'],
    };
    operations.push(operation);
    return {
      mark: () => {},
      afterPaint: () => {
        operation.outcome ??= 'success';
      },
      finish: (outcome = 'success') => {
        operation.outcome ??= outcome;
      },
    };
  },
}));

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const [requested, setRequested] = createSignal('a');
  return createRoot((dispose) => ({
    buffer: createBufferedThread(requested),
    setRequested,
    dispose,
  }));
}

it('keeps the open thread on screen until the next one has rendered', () => {
  const { buffer, setRequested, dispose } = setup();
  setRequested('b');
  expect(buffer.shown()).toBe('a');
  expect(buffer.mounted()).toEqual(['a', 'b']);

  buffer.settle('b');
  expect(buffer.shown()).toBe('b');
  expect(buffer.mounted()).toEqual(['b']);
  dispose();
});

it('never shows a thread that was stepped past before it rendered', () => {
  const { buffer, setRequested, dispose } = setup();
  setRequested('b');
  setRequested('c');
  expect(buffer.mounted()).toEqual(['a', 'c']);

  buffer.settle('b');
  expect(buffer.shown()).toBe('a');
  buffer.settle('c');
  expect(buffer.shown()).toBe('c');
  dispose();
});

it('shows a slow thread, loading state and all, after the deadline', () => {
  const { buffer, setRequested, dispose } = setup();
  setRequested('b');
  vi.advanceTimersByTime(THREAD_SWITCH_DEADLINE_MS - 1);
  expect(buffer.shown()).toBe('a');
  vi.advanceTimersByTime(1);
  expect(buffer.shown()).toBe('b');
  dispose();
});

it('traces each open by how it reached the screen', () => {
  operations.length = 0;
  const { buffer, setRequested, dispose } = setup();
  buffer.settle('a');
  setRequested('b');
  setRequested('c');
  buffer.settle('c');
  setRequested('d');
  vi.advanceTimersByTime(THREAD_SWITCH_DEADLINE_MS);
  setRequested('e');
  setRequested('d');
  dispose();

  expect(operations).toEqual([
    { threadId: 'a', outcome: 'success' },
    { threadId: 'b', outcome: 'cancelled' },
    { threadId: 'c', outcome: 'success' },
    // Shown at the deadline with its loading state, not rendered.
    { threadId: 'd', outcome: 'timeout' },
    // Stepped back to the thread on screen before it loaded.
    { threadId: 'e', outcome: 'cancelled' },
  ]);
});
