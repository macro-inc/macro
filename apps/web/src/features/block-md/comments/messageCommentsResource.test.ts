import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  documentId: 'task-document',
  parents: [] as Array<() => unknown>,
  post: vi.fn(),
}));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => mocks.documentId,
  }),
}));

vi.mock('@queries/messages/document-messages', () => ({
  useMessageActions: (parent: () => unknown) => {
    mocks.parents.push(parent);
    return { post: mocks.post };
  },
}));

import {
  useCreateMarkedMessageResource,
  useCreateMessageReplyResource,
} from './messageCommentsResource';

afterEach(() => {
  mocks.parents.length = 0;
  mocks.post.mockReset();
});

describe('message comment resources', () => {
  it('binds message actions to the markdown document without a block context', () => {
    createRoot((dispose) => {
      const createMarkedMessage = useCreateMarkedMessageResource();
      const createReply = useCreateMessageReplyResource();

      expect(mocks.parents).toHaveLength(2);
      expect(mocks.parents.map((parent) => parent())).toEqual([
        { type: 'document', id: 'task-document' },
        { type: 'document', id: 'task-document' },
      ]);
      expect(createReply).toBe(mocks.post);

      createMarkedMessage('A comment', 'mark-id');
      expect(mocks.post).toHaveBeenCalledWith({
        content: 'A comment',
        anchor: { type: 'markdown', mark_id: 'mark-id' },
        mentions: undefined,
        attachments: undefined,
      });

      dispose();
    });
  });
});
