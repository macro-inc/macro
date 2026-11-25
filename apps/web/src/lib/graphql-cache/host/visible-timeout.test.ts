import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { visibleTimeout } from './visible-timeout';

let state: DocumentVisibilityState = 'visible';

function show(next: DocumentVisibilityState): void {
  state = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  state = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('counts only the time the page is visible, across any number of hides', () => {
  const expired = vi.fn();
  visibleTimeout(expired, 10);
  vi.advanceTimersByTime(6);
  show('hidden');
  vi.advanceTimersByTime(1_000);
  show('visible');
  vi.advanceTimersByTime(3);
  show('hidden');
  vi.advanceTimersByTime(1_000);
  expect(expired).not.toHaveBeenCalled();
  show('visible');
  vi.advanceTimersByTime(1);
  expect(expired).toHaveBeenCalledOnce();
  show('hidden');
  show('visible');
  expect(vi.getTimerCount()).toBe(0);
});

it('never calls back once canceled', () => {
  const expired = vi.fn();
  const cancel = visibleTimeout(expired, 10);
  cancel();
  show('hidden');
  show('visible');
  vi.advanceTimersByTime(100);
  expect(expired).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
