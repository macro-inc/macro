import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailInboxDemo, EmailSignalNoiseDemo } from './EmailInboxDemo';
import { EmailSharingDemo } from './EmailSharingDemo';

let visibility: IntersectionObserverCallback;
let reducedMotion = false;
const disconnect = vi.fn();

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        visibility = callback;
      }
      observe() {}
      disconnect = disconnect;
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
  expect(fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it('combines account, tab and search filters and preserves them after opening a thread', () => {
  const view = render(() => <EmailInboxDemo />);
  const accounts = within(view.getByRole('navigation', { name: 'Inboxes' }));
  const tabs = within(view.getByRole('navigation', { name: 'Email tabs' }));
  fireEvent.click(
    accounts.getByRole('button', { name: 'jacob.beckerman@gmail.com' })
  );
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(3);
  fireEvent.click(tabs.getByRole('button', { name: 'Noise' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(2);
  fireEvent.click(accounts.getByRole('button', { name: 'All inboxes' }));
  fireEvent.click(tabs.getByRole('button', { name: 'All' }));
  fireEvent.input(view.getByLabelText('Search sample email'), {
    target: { value: 'Dana' },
  });
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(2);
  fireEvent.click(view.getByRole('button', { name: /^Read Next steps/ }));
  expect(view.getByText('Hi Jacob,')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to inbox' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(2);
  fireEvent.click(view.getByRole('button', { name: 'Filter email' }));
  fireEvent.click(view.getByRole('checkbox', { name: 'Unread only' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(1);
});

it('moves a thread between Signal and Noise without changing the other messages', () => {
  const view = render(() => <EmailSignalNoiseDemo />);
  const tabs = within(view.getByRole('navigation', { name: 'Email tabs' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(6);
  fireEvent.click(
    view.getByRole('button', { name: 'Move Product updates to Noise' })
  );
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(4);
  expect(
    view.getByRole('button', { name: 'Read September release notes' })
  ).toBeTruthy();
  fireEvent.click(tabs.getByRole('button', { name: 'Signal' }));
  expect(
    view.queryByRole('button', { name: 'Read September release notes' })
  ).toBeNull();
  fireEvent.click(
    view.getByRole('button', { name: 'Move Product updates back to Signal' })
  );
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(6);
  expect(
    view.getByRole('button', { name: 'Read September release notes' })
  ).toBeTruthy();
});

it('shares into a channel, sends a local message, and opens the original conversation', () => {
  const view = render(() => <EmailSharingDemo />);
  fireEvent.click(view.getByRole('button', { name: 'Share email' }));
  fireEvent.click(view.getByRole('button', { name: 'launch Channel' }));
  fireEvent.click(view.getByRole('button', { name: /Share.*⌘/ }));
  const send = view.getByRole('button', { name: 'Send demo message' });
  expect(send.hasAttribute('disabled')).toBe(true);
  fireEvent.input(view.getByRole('textbox', { name: 'Message #launch' }), {
    target: { value: 'The rollout is ready.' },
  });
  fireEvent.click(send);
  expect(view.getByText('The rollout is ready.')).toBeTruthy();
  expect(send.hasAttribute('disabled')).toBe(true);
  fireEvent.click(
    view.getByRole('button', {
      name: 'Open shared email: Next steps for our team',
    })
  );
  expect(view.getByText('Hi Jacob,')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to inbox' }));
  expect(view.getByRole('textbox', { name: 'Message #launch' })).toBeTruthy();
});

function setVisible(isIntersecting: boolean) {
  visibility(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

it('pauses playback offscreen, supports pause and replay, and cleans up its timer', () => {
  const view = render(() => <EmailSharingDemo />);
  const phase = () =>
    view.container
      .querySelector('.mail-sharing-demo')
      ?.getAttribute('data-phase');
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('0');
  setVisible(true);
  vi.advanceTimersByTime(1800);
  expect(phase()).toBe('1');
  setVisible(false);
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('1');
  setVisible(true);
  vi.advanceTimersByTime(1100);
  expect(phase()).toBe('2');
  fireEvent.click(
    view.getByRole('button', { name: 'Pause sharing animation' })
  );
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('2');
  fireEvent.click(view.getByRole('button', { name: 'Replay' }));
  expect(phase()).toBe('0');
  vi.advanceTimersByTime(7450);
  expect(phase()).toBe('6');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('shows the shared result without autoplay for reduced motion', () => {
  reducedMotion = true;
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  expect(
    view.getByRole('button', {
      name: 'Open shared email: Next steps for our team',
    })
  ).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Pause sharing animation' })
  ).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Replay' }));
  vi.advanceTimersByTime(10000);
  expect(
    view.getByRole('button', {
      name: 'Open shared email: Next steps for our team',
    })
  ).toBeTruthy();
});
