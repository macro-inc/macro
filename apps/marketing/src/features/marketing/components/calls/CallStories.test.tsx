import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CallDefaultDemo,
  CallFollowupDemo,
  CallHeroDemo,
  CallStartDemo,
  CallTranscriptDemo,
} from './CallStories';

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
const playerTime = (container: HTMLElement) =>
  container
    .querySelector('[data-call-time]')
    ?.textContent?.replace(/\s+/g, ' ');

it('shows the full call record and seeks when a transcript line is clicked', () => {
  const view = render(() => <CallHeroDemo />);
  expect(view.getByText('teo@macro.com')).toBeTruthy();
  expect(view.getByText('Summary')).toBeTruthy();
  expect(view.getByText('Recording')).toBeTruthy();
  expect(playerTime(view.container)).toBe('0:00 / 18:22');
  const line = view.getByRole('button', { name: 'Go to 1:12: Julia Westphal' });
  fireEvent.click(line);
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('1:12 / 18:22');
  fireEvent.click(view.getByRole('button', { name: 'Play' }));
  vi.advanceTimersByTime(3000);
  expect(playerTime(view.container)).toBe('1:15 / 18:22');
});

it('ends the live call and opens its new record from the Calls tab', () => {
  const view = render(() => <CallDefaultDemo />);
  expect(view.getByText('A call is active in this channel')).toBeTruthy();
  expect(view.getByText('12:03')).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(1000);
  expect(view.getByText('12:04')).toBeTruthy();
  vi.advanceTimersByTime(1000);
  expect(view.queryByText('A call is active in this channel')).toBeNull();
  vi.advanceTimersByTime(1400);
  const calls = within(view.getByRole('grid', { name: 'Calls' }));
  expect(calls.getByText('Invite bug triage')).toBeTruthy();
  expect(calls.getByText('12m 4s')).toBeTruthy();
  vi.advanceTimersByTime(1500);
  expect(view.getByRole('heading', { name: 'Invite bug triage' })).toBeTruthy();
  expect(view.getByText('gabriel@macro.com')).toBeTruthy();
  expect(
    view.getByRole('button', { name: 'Go to 0:03: Gabriel Birman' })
  ).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('shows the finished record without a cursor for reduced motion', () => {
  reduced = true;
  const view = render(() => <CallDefaultDemo />);
  expect(view.getByRole('heading', { name: 'Invite bug triage' })).toBeTruthy();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('jumps to the clicked line, then offers Sync to video time after scrolling away', () => {
  const view = render(() => <CallTranscriptDemo />);
  visible(true);
  vi.advanceTimersByTime(2100);
  const line = view.getByRole('button', { name: 'Go to 1:38: Teo' });
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('1:38 / 18:22');
  vi.advanceTimersByTime(1300);
  const sync = view.getByRole('button', { name: 'Sync to video time' });
  vi.advanceTimersByTime(2100);
  expect(sync.isConnected).toBe(false);
  expect(line.getAttribute('aria-pressed')).toBe('true');
});

it('lets a visitor choose a transcript line without being moved back by motion', () => {
  const view = render(() => <CallTranscriptDemo />);
  visible(true);
  const line = view.getByRole('button', { name: 'Go to 1:12: Julia Westphal' });
  fireEvent.pointerDown(line);
  fireEvent.click(line);
  reduce();
  vi.advanceTimersByTime(20000);
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('1:12 / 18:22');
});

it('has @Macro read the call and write what was decided into the task', () => {
  const view = render(() => <CallFollowupDemo />);
  expect(view.getByText(/Calling 1 tool/)).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(4000);
  expect(view.getByText(/Called 4 tools/)).toBeTruthy();
  expect(view.getByText('call transcript')).toBeTruthy();
  const task = within(view.getByRole('region', { name: 'Task' }));
  expect(
    task.getByRole('textbox', { name: 'Task description' }).textContent
  ).toContain('From this morning’s launch check-in');
  expect(
    task.getByRole('checkbox', { name: 'Existing accounts switch teams' })
  ).toBeTruthy();
});

it('starts a call from the channel header and shows everyone who joins', () => {
  const view = render(() => <CallStartDemo />);
  expect(view.getByRole('button', { name: 'Call' })).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(4300);
  expect(view.queryByRole('button', { name: 'Call' })).toBeNull();
  expect(view.getByText('Julia Westphal')).toBeTruthy();
  expect(view.getByText('Gabriel Birman')).toBeTruthy();
  expect(view.getByRole('status', { name: 'Teo is muted' })).toBeTruthy();
  expect(view.getByText('You')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Mute microphone' }));
  expect(view.getByRole('status', { name: 'You are muted' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  expect(view.getByText('A call is active in this channel')).toBeTruthy();
  expect(view.getAllByRole('button', { name: 'Join' }).length).toBe(2);
});
