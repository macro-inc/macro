import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ChannelThreadDemo } from './ChannelStories';

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
it('adds a reply to its original thread rather than a new channel message', () => {
  const view = render(() => <ChannelThreadDemo />);
  fireEvent.click(view.getByRole('button', { name: /2 replies/ }));
  const thread = view.container.querySelector('.sample-channel-thread')!;
  fireEvent.click(
    within(thread as HTMLElement).getAllByRole('button', {
      name: 'Reply',
    })[0]
  );
  const input = within(thread as HTMLElement).getByRole('textbox');
  input.textContent = 'Confirmed. Keep the invite flow first.';
  fireEvent.input(input);
  fireEvent.click(
    within(thread as HTMLElement).getByRole('button', {
      name: 'Send demo message',
    })
  );
  expect(
    within(thread as HTMLElement).getByText(
      'Confirmed. Keep the invite flow first.'
    )
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll('.sample-channel-thread')
  ).toHaveLength(2);
});
