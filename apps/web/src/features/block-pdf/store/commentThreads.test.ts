import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/block', () => ({
  createBlockMemo: (fn: () => unknown) => fn,
  useBlockId: () => 'document',
  useBlockName: () => 'pdf',
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableUnifiedDocumentDiscussions: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: () => ({ isSuccess: false, data: [] }),
}));
vi.mock('./commentsResource', () => ({
  commentThreadsResource: [() => undefined],
  sortComments: () => 0,
}));

import { findAnchorThread, type PdfCommentThread } from './commentThreads';

function thread(
  threadId: PdfCommentThread['threadId'],
  anchorId: string | null
): PdfCommentThread {
  return {
    threadId,
    rootId: threadId,
    anchorId,
    owner: 'user',
    comments: [],
    isResolved: false,
  };
}

describe('findAnchorThread', () => {
  const legacy = thread(1001, null);
  const shared = thread('root-uuid', 'anchor-uuid');

  it('matches a legacy anchor by its numeric thread id', () => {
    expect(
      findAnchorThread([shared, legacy], { uuid: 'x', threadId: 1001 })
    ).toBe(legacy);
  });

  it('matches a shared-discussion anchor by the exposed root id', () => {
    expect(
      findAnchorThread([legacy, shared], {
        uuid: 'unknown-to-the-discussion',
        threadId: null,
        rootId: 'root-uuid',
      })
    ).toBe(shared);
  });

  it('falls back to the anchor uuid the discussion names', () => {
    expect(
      findAnchorThread([legacy, shared], {
        uuid: 'anchor-uuid',
        threadId: null,
      })
    ).toBe(shared);
    expect(
      findAnchorThread([legacy, shared], { uuid: 'other', threadId: null })
    ).toBe(undefined);
  });
});
