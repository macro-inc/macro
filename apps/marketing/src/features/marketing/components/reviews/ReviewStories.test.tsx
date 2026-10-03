import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewDiscussionDemo, ReviewQueueDemo } from './ReviewStories';

let intersections: IntersectionObserverCallback[];
let motionListeners: (() => void)[];
let reduced = false;
let hidden = false;
beforeEach(() => {
  intersections = [];
  motionListeners = [];
  reduced = false;
  hidden = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) =>
      motionListeners.push(callback),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.advanceTimersByTime(100);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visible(value: boolean) {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: value } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}
function reduce() {
  reduced = true;
  for (const callback of motionListeners) callback();
}
it('combines review filters and search, opens the correct item, and preserves the queue', () => {
  const view = render(() => <ReviewQueueDemo />);
  fireEvent.click(view.getByRole('button', { name: 'All reviews' }));
  fireEvent.input(view.getByRole('searchbox'), {
    target: { value: 'announcement' },
  });
  fireEvent.click(
    view.getByRole('button', {
      name: 'Open review: Update the launch announcement',
    })
  );
  expect(
    view.getByRole('heading', { name: 'Update the launch announcement' })
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to reviews' }));
  expect((view.getByRole('searchbox') as HTMLInputElement).value).toBe(
    'announcement'
  );
  expect(
    view.queryByRole('button', {
      name: 'Open review: Retry transient deploy failures',
    })
  ).toBeNull();
});

it('filters bot messages without removing the human review and its line context', () => {
  const view = render(() => <ReviewDiscussionDemo />);
  fireEvent.click(view.getByRole('checkbox', { name: 'Hide bots (1)' }));
  expect(view.queryByText('Preview available for this branch.')).toBeNull();
  expect(view.getByText('deploy/retry.ts · L6')).toBeTruthy();
  expect(view.getByText(/Only temporary registry failures/)).toBeTruthy();
});
