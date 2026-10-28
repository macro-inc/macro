import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EmailInboxDemo, EmailSignalNoiseDemo } from './EmailInboxDemo';
import { EmailSharingDemo } from './EmailSharingDemo';
import { ChannelComposer } from './frozen/ChannelComposer';

let visibility: IntersectionObserverCallback;
let reducedMotion = false;
const disconnect = vi.fn();

beforeEach(() => {
  reducedMotion = false;
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: vi.fn(),
  });
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
  fireEvent.click(accounts.getByRole('button', { name: 'jacob@gmail.com' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(3);
  fireEvent.click(tabs.getByRole('button', { name: 'Noise' }));
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(2);
  fireEvent.click(accounts.getByRole('button', { name: 'All inboxes' }));
  fireEvent.click(tabs.getByRole('button', { name: 'All' }));
  fireEvent.input(view.getByLabelText('Search sample email'), {
    target: { value: 'Valentina' },
  });
  expect(view.getAllByRole('button', { name: /^Read / })).toHaveLength(2);
  fireEvent.click(
    view.getByRole('button', { name: /^Read Homepage feedback/ })
  );
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
      name: 'Open shared email: Thursday demo',
    })
  );
  expect(view.getByText(/Hi Jacob,/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Back to inbox' }));
  expect(view.getByRole('textbox', { name: 'Message #launch' })).toBeTruthy();
});

function setVisible(isIntersecting: boolean) {
  visibility(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

it('pauses playback offscreen and after interaction, and cleans up its timer', () => {
  const view = render(() => <EmailSharingDemo />);
  const phase = () =>
    view.container
      .querySelector('.mail-sharing-demo')
      ?.getAttribute('data-phase');
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('0');
  setVisible(true);
  advanceTo(() => phase() === '1');
  expect(phase()).toBe('1');
  setVisible(false);
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('1');
  setVisible(true);
  advanceTo(() => phase() === '2');
  expect(phase()).toBe('2');
  fireEvent.click(view.getByRole('button', { name: 'Close share preview' }));
  vi.advanceTimersByTime(10000);
  expect(phase()).toBe('0');
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('holds the live reply for reading before replay and keeps it available after takeover', () => {
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  vi.advanceTimersByTime(10650);
  expect(
    view.getByRole('button', { name: 'Open shared email: Thursday demo' })
      .textContent
  ).toBe('Thursday demo');
  expect(view.queryByText('Live')).toBeNull();
  expect(view.queryByText(/2 messages|Open full thread/)).toBeNull();
  expect(
    view.queryByText(
      'Valentina replied. Your whole team is already up to date.'
    )
  ).toBeNull();
  vi.advanceTimersByTime(3000);
  expect(
    view.getByRole('button', { name: 'Open shared email: Thursday demo' })
      .textContent
  ).toBe('Thursday demo');
  expect(view.queryByText('Live')).toBeNull();
  expect(view.queryByText(/2 messages|Open full thread/)).toBeNull();
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  fireEvent.click(
    view.getByRole('button', {
      name: 'Open shared email: Thursday demo',
    })
  );
  expect(view.getByText(/Hi Jacob,/)).toBeTruthy();
  expect(
    view.getByText(/Could you also send a short setup guide/)
  ).toBeTruthy();
  const messageDetails = view.getAllByRole('button', {
    name: 'Message details',
  });
  expect(messageDetails).toHaveLength(2);
  fireEvent.click(messageDetails[1]);
  expect(messageDetails[1].getAttribute('aria-expanded')).toBe('true');
  expect(messageDetails[0].getAttribute('aria-expanded')).toBe('false');
  expect(view.getAllByRole('heading', { name: 'Thursday demo' })).toHaveLength(
    1
  );
  expect(view.queryByRole('button', { name: /Play|Pause|Replay/ })).toBeNull();
});

it('shows the shared result without autoplay for reduced motion', () => {
  reducedMotion = true;
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  expect(
    view.getByRole('button', {
      name: 'Open shared email: Thursday demo',
    })
  ).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Pause sharing animation' })
  ).toBeNull();
  vi.advanceTimersByTime(10000);
  expect(
    view.getByRole('button', {
      name: 'Open shared email: Thursday demo',
    })
  ).toBeTruthy();
});

it('keeps local attachment names, permits removal, and clears them after sending', () => {
  const onSend = vi.fn();
  const view = render(() => <ChannelComposer onSend={onSend} />);
  const picker = view.getByLabelText('Choose local attachments');
  fireEvent.change(picker, {
    target: {
      files: [
        new File(['sample'], 'rollout.txt'),
        new File(['sample'], 'notes.txt'),
      ],
    },
  });
  fireEvent.click(
    view.getByRole('button', { name: 'Remove attachment notes.txt' })
  );
  fireEvent.click(view.getByRole('button', { name: 'Send demo message' }));
  expect(onSend).toHaveBeenCalledWith('Attached: rollout.txt');
  expect(
    view.queryByRole('button', { name: 'Remove attachment rollout.txt' })
  ).toBeNull();
  expect(
    view
      .getByRole('button', { name: 'Send demo message' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it('does not send while composing text or inserting a line break', () => {
  const onSend = vi.fn();
  const view = render(() => <ChannelComposer onSend={onSend} />);
  const input = view.getByRole('textbox');
  fireEvent.input(input, { target: { value: 'Ready for review' } });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(onSend).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSend).toHaveBeenCalledWith('Ready for review');
});

it('keeps existing channel messages mounted while the email walkthrough advances', () => {
  const view = render(() => <EmailSharingDemo />);
  const question = () =>
    view.getByText('What does Valentina need before Thursday?').closest('li');
  const original = question();
  const composer = view.getByRole('textbox', { name: 'Message #launch' });
  setVisible(true);
  vi.advanceTimersByTime(1800);
  expect(question()).toBe(original);
  advanceTo(() =>
    view.queryByRole('button', { name: 'Open shared email: Thursday demo' })
  );
  expect(question()).toBe(original);
  const shared = view.getByRole('button', {
    name: 'Open shared email: Thursday demo',
  });
  const sharedMessage = shared.closest('li');
  advanceTo(() =>
    view.queryByText('I’ll send the setup guide before the call.')
  );
  expect(question()).toBe(original);
  expect(
    view.getByRole('button', { name: 'Open shared email: Thursday demo' })
  ).toBe(shared);
  expect(shared.closest('li')).toBe(sharedMessage);
  const reply = view
    .getByText('I’ll send the setup guide before the call.')
    .closest('li');
  expect(view.getByRole('textbox', { name: 'Message #launch' })).toBe(composer);
  fireEvent.input(composer, { target: { value: 'Thanks, I’ll check it.' } });
  fireEvent.click(view.getByRole('button', { name: 'Send demo message' }));
  expect(view.getByText('Thanks, I’ll check it.')).toBeTruthy();
  expect(question()).toBe(original);
  expect(shared.closest('li')).toBe(sharedMessage);
  expect(
    view.getByText('I’ll send the setup guide before the call.').closest('li')
  ).toBe(reply);
});

function advanceTo(reached: () => unknown) {
  for (let elapsed = 0; elapsed < 30000 && !reached(); elapsed += 50)
    vi.advanceTimersByTime(50);
  expect(!!reached()).toBe(true);
}

it('types the share destination and message progressively and stops mid-draft on interaction', () => {
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  advanceTo(
    () =>
      view.container.querySelector('.mail-recipient-input .text-ink')
        ?.textContent
  );
  expect(
    view.container.querySelector('.mail-recipient-input .text-ink')?.textContent
  ).toBe('l');
  advanceTo(() => view.container.querySelector('[data-share-message]'));
  const message = view.container.querySelector('[data-share-message]')!;
  expect(message.textContent).toBe('H');
  fireEvent.pointerDown(message);
  vi.advanceTimersByTime(30000);
  expect(message.textContent).toBe('H');
  expect(
    view.queryByRole('button', { name: 'Open shared email: Thursday demo' })
  ).toBeNull();
});

it('keeps the same pointer while opening Share, choosing a channel, and typing the message', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      return this.matches('.mail-sharing-demo')
        ? new DOMRect(0, 0, 1000, 600)
        : new DOMRect(20, 20, 120, 32);
    }
  );
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  vi.advanceTimersByTime(1250);
  const pointer = view.container.querySelector('.demo-cursor');
  expect(pointer).toBeTruthy();
  expect(view.queryByRole('group', { name: 'Share email preview' })).toBeNull();
  advanceTo(() => view.queryByRole('group', { name: 'Share email preview' }));
  expect(view.container.querySelector('.demo-cursor')).toBe(pointer);
  advanceTo(() => view.container.querySelector('[data-share-message]'));
  expect(view.container.querySelector('.demo-cursor')).toBe(pointer);
  fireEvent.pointerDown(view.getByRole('button', { name: 'Cancel' }));
  vi.advanceTimersByTime(20000);
  expect(view.container.querySelector('.demo-cursor')).toBeNull();
  expect(
    view.queryByRole('button', { name: 'Open shared email: Thursday demo' })
  ).toBeNull();
});

it('leaves two seconds between Valentina’s reply and Julia’s response', () => {
  const view = render(() => <EmailSharingDemo />);
  setVisible(true);
  advanceTo(
    () =>
      view.container
        .querySelector('.mail-sharing-demo')
        ?.getAttribute('data-phase') === '7'
  );
  expect(
    view.getByText(/Could you also send a short setup guide/)
  ).toBeTruthy();
  expect(
    view.queryByText('I’ll send the setup guide before the call.')
  ).toBeNull();
  vi.advanceTimersByTime(1900);
  expect(
    view.queryByText('I’ll send the setup guide before the call.')
  ).toBeNull();
  vi.advanceTimersByTime(100);
  expect(
    view.getByText('I’ll send the setup guide before the call.')
  ).toBeTruthy();
});
