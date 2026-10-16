import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  CallDefaultDemo,
  CallFollowupDemo,
  CallHeroDemo,
  CallStartDemo,
  CallTranscriptDemo,
} from './CallStories';

import { CallTeamMemoryDemo } from './CallTeamMemoryDemo';

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
  fireEvent.click(view.getByRole('button', { name: 'After the call' }));
  expect(view.getByText('teo@macro.com')).toBeTruthy();
  expect(view.getByText('Summary')).toBeTruthy();
  expect(view.getByText('Recording')).toBeTruthy();
  expect(playerTime(view.container)).toBe('0:00 / 18:22');
  const line = view.getByRole('button', { name: 'Go to 1:12: Julia' });
  fireEvent.click(line);
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('1:12 / 18:22');
  fireEvent.click(view.getByRole('button', { name: 'Play' }));
  vi.advanceTimersByTime(3000);
  expect(playerTime(view.container)).toBe('1:15 / 18:22');
  fireEvent.click(view.getByRole('button', { name: 'In the call' }));
  vi.advanceTimersByTime(3000);
  fireEvent.click(view.getByRole('button', { name: 'After the call' }));
  expect(playerTime(view.container)).toBe('1:15 / 18:22');
  expect(view.getByRole('button', { name: 'Play' })).toBeTruthy();
});

it('adds the finished call to history without opening another record automatically', () => {
  const view = render(() => <CallDefaultDemo />);
  expect(view.getByRole('grid', { name: 'Calls' })).toBeTruthy();
  expect(view.queryByText('Training prep')).toBeNull();
  visible(true);
  vi.advanceTimersByTime(6000);
  const calls = within(view.getByRole('grid', { name: 'Calls' }));
  expect(calls.getByText('Training prep')).toBeTruthy();
  expect(view.queryByRole('heading', { name: 'Training prep' })).toBeNull();
  fireEvent.click(calls.getByRole('gridcell', { name: /Training prep/ }));
  expect(view.getByRole('heading', { name: 'Training prep' })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Go to 0:03: Julia' })).toBeTruthy();
});

it('shows finished call history without opening a record for reduced motion', () => {
  reduced = true;
  const view = render(() => <CallDefaultDemo />);
  expect(view.getByRole('grid', { name: 'Calls' })).toBeTruthy();
  expect(view.getByText('Training prep')).toBeTruthy();
  expect(view.queryByRole('heading', { name: 'Training prep' })).toBeNull();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
});

it('jumps to the clicked line, then offers Sync to video time after scrolling away', () => {
  const view = render(() => <CallTranscriptDemo />);
  visible(true);
  vi.advanceTimersByTime(1000);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  vi.advanceTimersByTime(1100);
  const line = view.getByRole('button', { name: 'Go to 1:12: Julia' });
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('1:12 / 18:22');
  vi.advanceTimersByTime(1300);
  const sync = view.getByRole('button', { name: 'Sync to video time' });
  vi.advanceTimersByTime(2100);
  expect(sync.isConnected).toBe(false);
  expect(line.getAttribute('aria-pressed')).toBe('true');
});

it('lets a visitor choose a transcript line without being moved back by motion', () => {
  const view = render(() => <CallTranscriptDemo />);
  visible(true);
  const line = view.getByRole('button', { name: 'Go to 0:41: Teo' });
  fireEvent.pointerDown(line);
  fireEvent.click(line);
  reduce();
  vi.advanceTimersByTime(20000);
  expect(line.getAttribute('aria-pressed')).toBe('true');
  expect(playerTime(view.container)).toBe('0:41 / 18:22');
});

it('uses the call to reassign the existing task and add pending next steps', () => {
  const view = render(() => <CallFollowupDemo />);
  expect(view.getByText(/Calling 1 tool/)).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(4000);
  expect(
    view
      .getByRole('button', { name: 'Called 4 tools' })
      .getAttribute('aria-expanded')
  ).toBe('false');
  expect(view.getByText('Teo → Julia')).toBeTruthy();
  expect(view.getByRole('button', { name: /^Training check-in/ })).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Linked item' })).toBeNull();
  fireEvent.click(
    within(view.getByRole('group', { name: 'Agent answer' })).getByRole(
      'button',
      { name: 'Prepare Thursday’s training' }
    )
  );
  const task = within(view.getByRole('region', { name: 'Linked item' }));
  expect(
    task.getByRole('textbox', { name: 'Task description' }).textContent
  ).toContain('From the training check-in');
  expect(
    task
      .getByRole('checkbox', { name: 'Get Teo’s notes today' })
      .getAttribute('aria-checked')
  ).toBe('false');
  expect(
    task.getByRole('checkbox', { name: 'Update the slides' })
  ).toBeTruthy();
});

it('starts a call from the channel header and shows everyone who joins', () => {
  const view = render(() => <CallStartDemo />);
  expect(view.getByRole('button', { name: 'Call' })).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(2200);
  expect(view.getByRole('button', { name: 'Call' })).toBeTruthy();
  expect(view.queryByText('Connecting...')).toBeNull();
  const cursor = view.container.querySelector('.demo-cursor');
  expect(cursor).toBeTruthy();
  expect(cursor?.textContent).toBe('');
  vi.advanceTimersByTime(1200);
  expect(cursor?.getAttribute('data-clicking')).toBe('true');
  vi.advanceTimersByTime(500);
  expect(view.getByText('Connecting...')).toBeTruthy();
  expect(view.queryByText('Julia')).toBeNull();
  vi.advanceTimersByTime(1800);
  expect(view.getByText('Julia')).toBeTruthy();
  expect(view.queryByText('Gabriel')).toBeNull();
  vi.advanceTimersByTime(1300);
  expect(view.queryByRole('button', { name: 'Call' })).toBeNull();
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  expect(view.getByText('Julia')).toBeTruthy();
  expect(view.getByText('Gabriel')).toBeTruthy();
  expect(view.getByRole('status', { name: 'Teo is muted' })).toBeTruthy();
  expect(view.getByText('You')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Mute microphone' }));
  expect(view.getByRole('status', { name: 'You are muted' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  expect(view.getByText('A call is active in this channel')).toBeTruthy();
  expect(view.getAllByRole('button', { name: 'Join' }).length).toBe(2);
});

it('keeps a visitor in the live hero after interacting, including a motion preference change', () => {
  const view = render(() => <CallHeroDemo />);
  visible(true);
  const mute = view.getByRole('button', { name: 'Mute microphone' });
  fireEvent.pointerDown(mute);
  fireEvent.click(mute);
  reduce();
  vi.advanceTimersByTime(20000);
  expect(view.getByRole('button', { name: 'Unmute microphone' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  expect(view.getByRole('heading', { name: 'Training check-in' })).toBeTruthy();
});

it('starts with one pane in reduced motion and preserves task edits through source navigation', () => {
  reduced = true;
  const view = render(() => <CallFollowupDemo />);
  expect(view.queryByRole('region', { name: 'Linked item' })).toBeNull();
  const result = within(
    view.getByRole('group', { name: 'Agent answer' })
  ).getByRole('button', { name: 'Prepare Thursday’s training' });
  fireEvent.click(result);
  let task = within(view.getByRole('region', { name: 'Linked item' }));
  expect(
    task
      .getAllByRole('button', { name: 'Change assignee' })
      .every((button) => button.textContent?.includes('Julia'))
  ).toBe(true);
  const step = task.getByRole('checkbox', {
    name: 'Update the slides',
  });
  expect(step.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(step);
  fireEvent.keyDown(view.getByRole('button', { name: 'Close linked item' }), {
    key: 'Escape',
  });
  expect(document.activeElement).toBe(result);
  expect(view.queryByRole('region', { name: 'Linked item' })).toBeNull();
  const source = view.getByRole('button', {
    name: /^Training check-in/,
  });
  fireEvent.click(source);
  const close = view.getByRole('button', { name: 'Close linked item' });
  expect(document.activeElement).toBe(close);
  expect(view.getByRole('heading', { name: 'Training check-in' })).toBeTruthy();
  fireEvent.click(close);
  expect(document.activeElement).toBe(source);
  fireEvent.click(result);
  task = within(view.getByRole('region', { name: 'Linked item' }));
  expect(
    task
      .getByRole('checkbox', { name: 'Update the slides' })
      .getAttribute('aria-checked')
  ).toBe('true');
});

it('opening a task takes control before the scripted edit and later motion changes', () => {
  const view = render(() => <CallFollowupDemo />);
  visible(true);
  vi.advanceTimersByTime(1600);
  fireEvent.click(
    view.getByRole('button', { name: 'Prepare Thursday’s training' })
  );
  const task = within(view.getByRole('region', { name: 'Linked item' }));
  reduce();
  vi.advanceTimersByTime(20000);
  expect(
    task
      .getAllByRole('button', { name: 'Change assignee' })
      .every((button) => button.textContent?.includes('Teo'))
  ).toBe(true);
  expect(
    task.queryByRole('checkbox', {
      name: 'Update the slides',
    })
  ).toBeNull();
});

it('keeps a recognizable call visible without screen sharing or simulated video', () => {
  const view = render(() => <CallHeroDemo />);
  expect(
    view.getByRole('button', { name: 'Share screen' }).hasAttribute('disabled')
  ).toBeTruthy();
  visible(true);
  vi.advanceTimersByTime(20000);
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  expect(view.queryByRole('checkbox', { name: 'Share with team' })).toBeNull();
  expect(view.container.querySelector('.call-camera')).toBeNull();
  expect(view.container.querySelector('.call-shared-work')).toBeNull();
  expect(view.queryByText('Your screen')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'After the call' }));
  expect(view.container.querySelector('.call-poster-video')).toBeNull();
});

it('finds a missed call from words in its transcript, then opens that source', () => {
  reduced = true;
  const view = render(() => <CallDefaultDemo />);
  fireEvent.input(view.getByRole('searchbox', { name: 'Search calls' }), {
    target: { value: 'half an hour' },
  });
  const rows = view.getAllByRole('gridcell');
  expect(rows).toHaveLength(1);
  expect(rows[0].textContent).toContain('Training prep');
  fireEvent.click(rows[0]);
  expect(view.getByText(/We’ve got half an hour/)).toBeTruthy();
});

it('preserves call chat in the saved record and lets the visitor call again', () => {
  const view = render(() => <CallHeroDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Open chat' }));
  const composer = view.getByRole('textbox', { name: 'Message this call' });
  fireEvent.input(composer, {
    target: { value: 'Please send the final attendee list.' },
  });
  fireEvent.click(view.getByRole('button', { name: 'Send demo message' }));
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  expect(view.getByText('Please send the final attendee list.')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Call Again' }));
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
});

it('replays the start-call story on return, without looping while visible', () => {
  const view = render(() => <CallStartDemo />);
  visible(true);
  vi.advanceTimersByTime(9000);
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  vi.advanceTimersByTime(30000);
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  visible(false);
  visible(true);
  expect(view.getByRole('button', { name: 'Call' })).toBeTruthy();
  vi.advanceTimersByTime(9000);
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
});

it('does not replay over a visitor’s call controls after leaving and returning', () => {
  const view = render(() => <CallStartDemo />);
  visible(true);
  vi.advanceTimersByTime(9000);
  const mute = view.getByRole('button', { name: 'Mute microphone' });
  fireEvent.pointerDown(mute);
  fireEvent.click(mute);
  visible(false);
  visible(true);
  vi.advanceTimersByTime(10000);
  expect(view.getByRole('button', { name: 'Unmute microphone' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Call' })).toBeNull();
});

it('keeps the completed start-call view for reduced motion on return', () => {
  reduced = true;
  const view = render(() => <CallStartDemo />);
  visible(true);
  visible(false);
  visible(true);
  expect(view.getByRole('button', { name: 'Leave call' })).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Call' })).toBeNull();
});

it('shares a channel call with an absent teammate and opens its transcript', () => {
  const view = render(() => <CallTeamMemoryDemo />);
  expect(
    (
      view.getByRole('checkbox', {
        name: 'Share with team',
      }) as HTMLInputElement
    ).checked
  ).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  fireEvent.click(view.getByRole('gridcell', { name: /Training prep/ }));
  expect(view.getByRole('heading', { name: 'Summary' })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Go to 1:02: Julia' }));
  expect(playerTime(view.container)).toContain('1:02');
});
it('does not expose an unshared recording to the absent teammate', () => {
  const view = render(() => <CallTeamMemoryDemo />);
  fireEvent.click(view.getByRole('checkbox', { name: 'Share with team' }));
  fireEvent.click(view.getByRole('button', { name: 'Leave call' }));
  expect(view.queryByRole('gridcell', { name: /Training prep/ })).toBeNull();
  expect(
    view.getByText('This call wasn’t shared with Gabriel’s team.')
  ).toBeTruthy();
});

it('uses the toolbar hang-up control and a cursor to walk through team memory', () => {
  const view = render(() => <CallTeamMemoryDemo />);
  expect(view.queryByRole('button', { name: 'End call' })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(1900);
  expect(view.container.querySelector('.call-memory-pointer')).toBeTruthy();
  vi.advanceTimersByTime(9000);
  expect(playerTime(view.container)).toContain('1:02');
  expect(view.container.querySelector('.call-memory-pointer')).toBeNull();
});
