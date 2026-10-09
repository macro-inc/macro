import type { EmailThreadSource } from '@app/features/email-thread/context/email-thread-context';
import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { createHeldThreadSource } from './held-thread-source';

const thread = (id: string): EmailThread => ({
  access_level: 'owner',
  db_id: id,
  inbox_visible: true,
  is_read: true,
  link_id: 'link',
  messages: [],
});

function mount() {
  return createRoot((dispose) => {
    const [threadId, setThreadId] = createSignal('a');
    const [loaded, setLoaded] = createSignal<Record<string, EmailThread>>({
      a: thread('a'),
    });
    const [failed, setFailed] = createSignal(false);
    const [holding, setHolding] = createSignal(false);
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
    const display = createHeldThreadSource({ threadId, source, holding });
    const load = (id: string) =>
      setLoaded((current) => ({ ...current, [id]: thread(id) }));
    return {
      dispose,
      display,
      setThreadId,
      load,
      setFailed,
      setHolding,
    };
  });
}

describe('createHeldThreadSource', () => {
  it('drops to the loading state when navigating without a held key', () => {
    const view = mount();
    view.setThreadId('b');
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.threadId()).toBe('b');
    expect(view.display.source.thread()).toBeUndefined();
    expect(view.display.source.isLoading()).toBe(true);
    view.dispose();
  });

  it('keeps the last loaded thread across unloaded threads while held', () => {
    const view = mount();
    view.setHolding(true);
    view.setThreadId('b');
    view.setThreadId('c');
    expect(view.display.isHeld()).toBe(true);
    expect(view.display.threadId()).toBe('a');
    expect(view.display.source.id()).toBe('a');
    expect(view.display.source.thread()?.db_id).toBe('a');
    expect(view.display.source.isLoading()).toBe(false);
    view.dispose();
  });

  it('shows the requested thread once it loads while still held', () => {
    const view = mount();
    view.setHolding(true);
    view.setThreadId('b');
    view.load('b');
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.threadId()).toBe('b');
    expect(view.display.source.thread()?.db_id).toBe('b');
    view.setThreadId('c');
    expect(view.display.source.thread()?.db_id).toBe('b');
    view.dispose();
  });

  it('releases to the loading state when the key is let go', () => {
    const view = mount();
    view.setHolding(true);
    view.setThreadId('b');
    view.setHolding(false);
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.threadId()).toBe('b');
    expect(view.display.source.thread()).toBeUndefined();
    view.dispose();
  });

  it('does not hide a load error behind the held thread', () => {
    const view = mount();
    view.setHolding(true);
    view.setThreadId('b');
    view.setFailed(true);
    expect(view.display.isHeld()).toBe(false);
    expect(view.display.source.isError()).toBe(true);
    view.dispose();
  });
});
