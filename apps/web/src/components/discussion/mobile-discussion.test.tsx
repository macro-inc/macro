import type { ConversationPresentation } from '@core/messages/EntityConversation';
import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, For } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MobileDiscussion } from './mobile-discussion';

vi.mock('@core/user', () => ({
  tryMacroId: (id: string) => id,
  getDisplayName: () => 'Member',
  getInitialsFromName: () => 'M',
}));
vi.mock('@core/messages/EntityConversation', () => ({
  EntityConversationComposer: () => null,
}));

let drawerStyles: HTMLStyleElement;
beforeEach(() => {
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('scrollTo', vi.fn());
  setVirtualKeyboardVisible(false);
});
afterEach(() => {
  cleanup();
  drawerStyles.remove();
  setVirtualKeyboardVisible(false);
  vi.unstubAllGlobals();
});

// This guards count-triggered forced scrolling, not browser scroll anchoring.
it('does not force the sheet to the bottom when earlier comments increase the count', async () => {
  const newest: MessageListItem = {
    id: 'newest',
    parent: { type: 'initiative', id: 'project' },
    sender_id: 'member',
    content: 'Newest comment',
    created_at: '2026-10-02T12:00:00Z',
    updated_at: '2026-10-02T12:00:00Z',
    mentions: [],
    attachments: [],
    reactions: [],
    state: {
      root_id: 'newest',
      user_id: 'member',
      anchor: null,
      resolved: false,
      created_at: '',
      updated_at: '',
    },
    thread: { reply_count: 0, preview: [], latest_reply_at: null },
  };
  const older: MessageListItem = {
    ...newest,
    id: 'older',
    content: 'Older comment',
    created_at: '2026-10-01T12:00:00Z',
    state: { ...newest.state, root_id: 'older' },
  };
  const [messages, setMessages] = createSignal([newest]);
  const conversation: ConversationPresentation = {
    messages,
    targetId: () => null,
    targetRequestKey: () => undefined,
    pending: () => false,
    unavailable: () => false,
    hasEarlier: () => messages().length === 1,
    failed: () => false,
    retry: () => {},
    content: () => (
      <>
        <button onClick={() => setMessages([older, newest])}>
          Load earlier comments
        </button>
        <For each={messages()}>{(message) => <p>{message.content}</p>}</For>
      </>
    ),
  };
  render(() => (
    <MobileDiscussion
      conversation={conversation}
      parent={newest.parent}
      canWrite={false}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: /Newest comment/ }));
  const sheet = await screen.findByRole('dialog');
  const thread = sheet.querySelector<HTMLElement>('[data-drawer-scroll-body]')!;
  Object.defineProperty(thread, 'scrollHeight', {
    get: () => messages().length * 1000,
  });
  thread.scrollTop = 240;

  fireEvent.click(
    screen.getByRole('button', { name: 'Load earlier comments' })
  );
  await Promise.resolve();
  expect(screen.getByText('Older comment')).toBeTruthy();
  expect(sheet.textContent).toContain('Discussion 2');
  expect(thread.scrollTop).toBe(240);
});
