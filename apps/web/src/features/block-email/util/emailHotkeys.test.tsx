import type { EmailThreadKeyboardHandlers } from '@app/features/email-thread/core/thread-keyboard';
import {
  attachGlobalDOMScope,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { registerEmailHotkeys } from './emailHotkeys';

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));

afterEach(() => setActiveScope('global'));

function press(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
}

function setup() {
  const ran: string[] = [];
  const record = (name: string) => () => {
    ran.push(name);
    return true;
  };
  const [unread, setUnread] = createSignal(false);
  const handlers: EmailThreadKeyboardHandlers = {
    activate: record('activate'),
    cancel: record('cancel'),
    replyToSenderOfFocusedMessage: record('reply to sender'),
    replyAllToFocusedMessage: record('reply all'),
    forwardFocusedMessage: record('forward'),
    canActOnSender: () => true,
    blockSender: record('block sender'),
    markDone: record('done'),
    markNotDone: record('not done'),
    isThreadDone: () => false,
    canMarkNotDone: () => true,
    markUnread: () => {
      ran.push('unread');
      setUnread(true);
      return true;
    },
    markRead: () => {
      ran.push('read');
      setUnread(false);
      return true;
    },
    isThreadMarkedUnread: unread,
    markSenderSignal: record('signal'),
    markSenderNoise: record('noise'),
    navigateToPreviousMessage: record('previous'),
    navigateToNextMessage: record('next'),
    expandFocusedMessage: record('expand'),
    expandAllMessages: record('expand all'),
  };

  function Harness() {
    useHotKeyRoot();
    const [attachThread, threadScope] = useHotkeyDOMScope('email-thread');
    registerEmailHotkeys(threadScope, handlers);
    return (
      <div ref={(element) => attachGlobalDOMScope(element)}>
        <div ref={attachThread} tabIndex={0} data-testid="thread" />
      </div>
    );
  }

  const view = render(() => <Harness />);
  view.getByTestId('thread').focus();
  return { ran };
}

it('toggles the thread between read and unread with u', () => {
  const { ran } = setup();
  press('u');
  press('u');
  press('u');
  expect(ran).toEqual(['unread', 'read', 'unread']);
});

it('replies to the sender with r', () => {
  const { ran } = setup();
  press('r');
  expect(ran).toEqual(['reply to sender']);
});
