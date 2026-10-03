import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ChannelAgentDemo,
  ChannelSharedWorkDemo,
  ChannelThreadDemo,
  ChatInboxDemo,
} from './ChannelStories';

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
it('shows the first replies inline and expands the rest from the pill', () => {
  const view = render(() => <ChannelThreadDemo />);
  const thread = view.container.querySelector(
    '[data-thread-id="root"]'
  ) as HTMLElement;
  expect(within(thread).getByText(/Lead with the invite flow/)).toBeTruthy();
  expect(within(thread).queryByText(/publishing at 9/)).toBeNull();
  fireEvent.click(within(thread).getByText('2 more replies'));
  expect(within(thread).getByText(/publishing at 9/)).toBeTruthy();
});

it('adds a reply to its original thread rather than a new channel message', () => {
  const view = render(() => <ChannelThreadDemo />);
  const thread = () =>
    view.container.querySelector('[data-thread-id="root"]') as HTMLElement;
  fireEvent.click(within(thread()).getByText('2 more replies'));
  fireEvent.click(
    within(thread()).getByRole('button', { name: 'Reply in thread' })
  );
  const input = within(thread()).getByRole('textbox', {
    name: 'Thread reply',
  });
  input.textContent = 'Confirmed. Keep the invite flow first.';
  fireEvent.input(input);
  fireEvent.click(
    within(thread()).getByRole('button', { name: 'Send demo message' })
  );
  expect(
    within(thread()).getByText('Confirmed. Keep the invite flow first.')
  ).toBeTruthy();
  expect(
    view.container.querySelectorAll('.sample-channel-thread')
  ).toHaveLength(2);
});

it('clears Home items with E and keeps the rest for later', () => {
  const view = render(() => <ChatInboxDemo />);
  visible(true);
  vi.advanceTimersByTime(900);
  expect(
    view.container.querySelector('[data-home-item="launch-thread"]')
  ).toBeTruthy();
  vi.advanceTimersByTime(3200);
  expect(
    view.container.querySelector('[data-home-item="launch-thread"]')
  ).toBeNull();
  expect(view.container.querySelector('[data-home-item="dm-teo"]')).toBeNull();
  expect(
    view.container.querySelector('[data-home-item="invite-task"]')
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Mark unread (U)' }));
  expect(
    view.container.querySelector(
      '[data-home-item="dana"] [aria-label="Unread"]'
    )
  ).toBeTruthy();
});

it('opens the mentioned doc from the channel', () => {
  reduced = true;
  const view = render(() => <ChannelSharedWorkDemo />);
  expect(view.getByRole('textbox', { name: 'Document body' })).toBeTruthy();
});

it('answers in the channel with the tasks it is talking about', () => {
  const view = render(() => <ChannelAgentDemo />);
  const log = within(view.getByRole('log', { name: 'Channel launch' }));
  expect(log.queryByText(/Nothing else is blocked/)).toBeNull();
  visible(true);
  vi.advanceTimersByTime(1400);
  expect(log.getByText(/Nothing else is blocked/)).toBeTruthy();
  expect(log.getByText('Fix the team invite handoff')).toBeTruthy();
  expect(log.getByText('Prepare the launch checklist')).toBeTruthy();
});

it('shows the agent answer for reduced motion', () => {
  reduce();
  const view = render(() => <ChannelAgentDemo />);
  expect(view.getByText(/Nothing else is blocked/)).toBeTruthy();
});
