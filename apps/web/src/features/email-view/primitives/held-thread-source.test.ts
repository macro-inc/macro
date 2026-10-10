import type { EmailThreadSource } from '@app/features/email-thread/context/email-thread-context';
import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import {
  createHeldThreadSource,
  createThreadNavigationHold,
  type ThreadNavigationHold,
} from './held-thread-source';

const thread = (id: string): EmailThread => ({
  access_level: 'owner',
  db_id: id,
  inbox_visible: true,
  is_read: true,
  link_id: 'link',
  messages: [],
});

const key = (type: 'keydown' | 'keyup', name = 'j') =>
  new KeyboardEvent(type, { key: name });

function mountHold() {
  return createRoot((dispose) => ({
    dispose,
    hold: createThreadNavigationHold(),
  }));
}

function mountView(hold: ThreadNavigationHold, initialId = 'a') {
  return createRoot((dispose) => {
    const [threadId, setThreadId] = createSignal(initialId);
    const [loaded, setLoaded] = createSignal<Record<string, EmailThread>>({
      a: thread('a'),
    });
    const [failed, setFailed] = createSignal(false);
    const source: EmailThreadSource = {
      id: threadId,
      thread: () => loaded()[threadId()],
      isError: failed,
      isLoading: () => !loaded()[threadId()],
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      fetchOlder: async () => {},
      refresh: async () => {},
    };
    const display = createHeldThreadSource({ threadId, source, hold });
    const load = (id: string) =>
      setLoaded((current) => ({ ...current, [id]: thread(id) }));
    return { dispose, display, setThreadId, load, setFailed };
  });
}

describe('createThreadNavigationHold', () => {
  it('holds from the stepping keydown until that key is released', () => {
    const { hold, dispose } = mountHold();
    hold.press(key('keydown'));
    expect(hold.held()).toBe(true);
    window.dispatchEvent(key('keyup', 'k'));
    expect(hold.held()).toBe(true);
    window.dispatchEvent(key('keyup'));
    expect(hold.held()).toBe(false);
    dispose();
  });

  it('releases when the window loses focus', () => {
    const { hold, dispose } = mountHold();
    hold.press(key('keydown', 'ArrowRight'));
    window.dispatchEvent(new Event('blur'));
    expect(hold.held()).toBe(false);
    dispose();
  });
});

describe('createHeldThreadSource', () => {
  it('drops to the loading state when navigating without a held key', () => {
    const { hold, dispose } = mountHold();
    const view = mountView(hold);
    view.setThreadId('b');
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.threadId()).toBe('b');
    expect(view.display.source.thread()).toBeUndefined();
    expect(view.display.source.isLoading()).toBe(true);
    view.dispose();
    dispose();
  });

  it('keeps the last loaded thread across unloaded threads while held', () => {
    const { hold, dispose } = mountHold();
    const view = mountView(hold);
    hold.press(key('keydown'));
    view.setThreadId('b');
    view.setThreadId('c');
    expect(view.display.isHeld()).toBe(true);
    expect(view.display.threadId()).toBe('a');
    expect(view.display.source.id()).toBe('a');
    expect(view.display.source.thread()?.db_id).toBe('a');
    expect(view.display.source.isLoading()).toBe(false);
    view.dispose();
    dispose();
  });

  it('carries the held thread into the next remounted view', () => {
    const { hold, dispose } = mountHold();
    const first = mountView(hold);
    hold.press(key('keydown'));
    first.dispose();
    const next = mountView(hold, 'b');
    expect(next.display.threadId()).toBe('a');
    expect(next.display.source.thread()?.db_id).toBe('a');
    next.load('b');
    expect(next.display.threadId()).toBe('b');
    next.dispose();
    dispose();
  });

  it('shows the requested thread once it loads while still held', () => {
    const { hold, dispose } = mountHold();
    const view = mountView(hold);
    hold.press(key('keydown'));
    view.setThreadId('b');
    view.load('b');
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.source.thread()?.db_id).toBe('b');
    view.setThreadId('c');
    expect(view.display.source.thread()?.db_id).toBe('b');
    view.dispose();
    dispose();
  });

  it('releases to the loading state when the key is let go', () => {
    const { hold, dispose } = mountHold();
    const view = mountView(hold);
    hold.press(key('keydown'));
    view.setThreadId('b');
    window.dispatchEvent(key('keyup'));
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.threadId()).toBe('b');
    expect(view.display.source.thread()).toBeUndefined();
    view.dispose();
    dispose();
  });

  it('does not hide a load error behind the held thread', () => {
    const { hold, dispose } = mountHold();
    const view = mountView(hold);
    hold.press(key('keydown'));
    view.setThreadId('b');
    view.setFailed(true);
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.source.isError()).toBe(true);
    view.dispose();
    dispose();
  });
});
