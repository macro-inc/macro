import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EmailThread } from './core/email-thread';
import { createThreadReadAdapter } from './thread-read-adapter';

const mocks = vi.hoisted(() => ({
  markReadOnOpen: true,
  markSeen: vi.fn(),
}));

vi.mock('@app/preferences/email-read-on-open', () => ({
  markEmailReadOnOpen: () => mocks.markReadOnOpen,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@queries/soup/cache', () => ({ refetchSoupEntity: vi.fn() }));
vi.mock('@queries/email/thread', () => ({
  useMarkThreadAsSeenMutation: () => ({
    isPending: false,
    mutate: mocks.markSeen,
  }),
  useMarkThreadAsUnreadMutation: () => ({ isPending: false, mutate: vi.fn() }),
}));

function unreadThread(id: string) {
  return { db_id: id, is_read: false } as EmailThread;
}

function createAdapter() {
  return createRoot((dispose) => {
    const [threadId, setThreadId] = createSignal('thread-1');
    const [thread, setThread] = createSignal<EmailThread | undefined>(
      unreadThread('thread-1')
    );
    const adapter = createThreadReadAdapter(threadId, thread);
    const open = (id: string) => {
      setThreadId(id);
      setThread(unreadThread(id));
    };
    return { adapter, open, dispose };
  });
}

afterEach(() => {
  mocks.markReadOnOpen = true;
  mocks.markSeen.mockReset();
});

describe('createThreadReadAdapter', () => {
  it('keeps an unread thread unread until it is marked read by hand', () => {
    mocks.markReadOnOpen = false;
    const { adapter, open, dispose } = createAdapter();
    try {
      expect(adapter.isThreadMarkedUnread()).toBe(true);
      expect(adapter.markThreadRead()).toBe(true);
      expect(mocks.markSeen).toHaveBeenCalledExactlyOnceWith(
        { threadId: 'thread-1' },
        expect.anything()
      );
      expect(adapter.isThreadMarkedUnread()).toBe(false);

      open('thread-2');
      expect(adapter.isThreadMarkedUnread()).toBe(true);
    } finally {
      dispose();
    }
  });
});
