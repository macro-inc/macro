import type { ConversationPresentation } from '@core/messages/EntityConversation';
import {
  setVirtualKeyboardHeight,
  setVirtualKeyboardVisible,
} from '@core/mobile/virtualKeyboard';
import type { MessageListItem } from '@service-storage/messages';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
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
const resizeObservers = new Set<ControlledResizeObserver>();
class ControlledResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeObservers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    resizeObservers.delete(this);
  }
  deliver(target: Element) {
    if (!this.targets.has(target)) return;
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this
    );
  }
}
beforeEach(() => {
  drawerStyles = document.createElement('style');
  drawerStyles.textContent =
    '[data-corvu-drawer-content] { transition-duration: 0s; animation-name: none; }';
  document.head.append(drawerStyles);
  vi.stubGlobal('ResizeObserver', ControlledResizeObserver);
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal('visualViewport', new EventTarget());
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
});
afterEach(() => {
  cleanup();
  drawerStyles.remove();
  setVirtualKeyboardVisible(false);
  setVirtualKeyboardHeight(0);
  resizeObservers.clear();
  vi.unstubAllGlobals();
});

// Geometry delivery is explicit; browser scroll anchoring still needs device verification.
it('preserves paging and linked-comment positions while keeping keyboard scrolling', async () => {
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
  const [target, setTarget] = createSignal<string | null>(null);
  const conversation: ConversationPresentation = {
    messages,
    targetId: target,
    targetRequestKey: () => undefined,
    pending: () => false,
    unavailable: () => false,
    failed: () => false,
    retry: () => {},
    content: () => (
      <>
        <button onClick={() => setMessages([older, newest])}>
          Load earlier comments
        </button>
        <For each={messages()}>
          {(message) => <p data-message-id={message.id}>{message.content}</p>}
        </For>
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
  for (const observer of resizeObservers) observer.deliver(thread);
  expect(screen.getByText('Older comment')).toBeTruthy();
  expect(
    within(sheet).getByRole('heading', { name: 'Discussion' })
  ).toBeTruthy();
  expect(thread.scrollTop).toBe(240);

  window.visualViewport?.dispatchEvent(new Event('resize'));
  expect(thread.scrollTop).toBe(240);

  // Safari changes visibility and then its visual viewport, without a height signal.
  setVirtualKeyboardVisible(true);
  await Promise.resolve();
  expect(thread.scrollTop).toBe(thread.scrollHeight);
  thread.scrollTop = 240;
  window.visualViewport?.dispatchEvent(new Event('resize'));
  expect(thread.scrollTop).toBe(thread.scrollHeight);

  thread.scrollTop = 240;
  setVirtualKeyboardHeight(300);
  await Promise.resolve();
  expect(thread.scrollTop).toBe(thread.scrollHeight);

  const olderMessage = screen.getByText('Older comment');
  thread.style.overflowY = 'auto';
  const scrollToTarget = vi.fn(() => {
    thread.scrollTop = 240;
  });
  olderMessage.scrollIntoView = scrollToTarget;
  thread.scrollTop = 1400;
  setTarget('older');
  expect(scrollToTarget).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'center',
  });
  expect(thread.scrollTop).toBe(240);
  setVirtualKeyboardHeight(0);
  setVirtualKeyboardVisible(false);
  await Promise.resolve();
  setVirtualKeyboardVisible(true);
  setVirtualKeyboardHeight(300);
  window.visualViewport?.dispatchEvent(new Event('resize'));
  await Promise.resolve();
  expect(thread.scrollTop).toBe(240);
});
