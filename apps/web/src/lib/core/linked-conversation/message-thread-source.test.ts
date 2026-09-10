import type { Message, MessageThread } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { createMessageThreadSource } from './message-thread-source';

const query = vi.hoisted(() => ({ useMessageThreadQuery: vi.fn() }));
vi.mock('@queries/messages', () => query);
vi.mock('@core/messages/message-data', () => ({
  messageToMessageData: (message: Message) => message,
}));

it('removes a deleted discussion from a linked drawer while its cached root remains', () => {
  createRoot((dispose) => {
    try {
      const parent = { type: 'document', id: 'document' } as const;
      const root: Message = {
        id: 'root',
        parent,
        sender_id: 'user',
        content: 'Discussion that will be deleted',
        mentions: [],
        attachments: [],
        reactions: [],
        created_at: '2026-09-09T00:00:00Z',
        updated_at: '2026-09-09T00:00:00Z',
      };
      const [thread, setThread] = createSignal<MessageThread>({
        root,
        replies: [{ ...root, id: 'reply', thread_id: root.id }],
        state: {
          root_id: root.id,
          user_id: root.sender_id,
          resolved: false,
          anchor: null,
          created_at: root.created_at,
          updated_at: root.updated_at,
        },
      });
      query.useMessageThreadQuery.mockReturnValue({
        isSuccess: true,
        isError: false,
        get data() {
          return thread();
        },
      });
      const source = createMessageThreadSource(
        () => parent,
        () => root.id
      );
      expect(source.root()?.content).toBe(root.content);
      expect(source.replyCount?.()).toBe(1);
      expect(source.unavailable?.()).toBe(false);

      // ThreadUpdated carries state, not replacement message bodies.
      setThread((current) => ({
        ...current,
        state: { ...current.state, deleted_at: '2026-09-09T01:00:00Z' },
        replies: [],
      }));
      expect(thread().root.content).toBe(root.content);
      expect(source.root()).toBeUndefined();
      expect(source.replies()).toEqual([]);
      expect(source.replyCount?.()).toBeUndefined();
      expect(source.unavailable?.()).toBe(true);
    } finally {
      dispose();
    }
  });
});
