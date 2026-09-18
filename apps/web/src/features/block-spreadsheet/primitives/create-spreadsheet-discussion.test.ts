import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { spreadsheetCommentAnchor } from '../core/spreadsheet-comments';
import {
  createSpreadsheetDiscussion,
  spreadsheetDiscussionThread,
} from './create-spreadsheet-discussion';

const anchor = { sheetId: 'sheet-1', sheetName: 'Budget', range: 'B4:C9' };
const comment = {
  id: '42',
  threadId: '7',
  authorId: 'me',
  text: 'Budget?',
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
};
const server: CommentThread = {
  thread: {
    threadId: 7,
    documentId: 'doc',
    owner: 'me',
    resolved: false,
    metadata: { spreadsheet: anchor },
  },
  comments: [
    { commentId: 42, threadId: 7, owner: 'me', text: 'Budget?', order: 0 },
  ],
};
function setup() {
  const [canComment, setCanComment] = createSignal(true);
  const [threads, setThreads] = createSignal([server]);
  const [target, setTarget] = createSignal<string | null>(null);
  const api = {
    create: vi.fn(async () => ({})),
    edit: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  };
  const refresh = vi.fn(async () => {});
  const source = createSpreadsheetDiscussion({
    threads,
    canComment,
    userId: () => 'me',
    anchor: () => anchor,
    targetCommentId: target,
    targetRevision: target,
    api,
    refresh,
    buildLink: (id) => `https://macro.com/app/spreadsheet/doc?comment_id=${id}`,
  });
  return { source, api, refresh, setCanComment, setThreads, setTarget };
}

describe('spreadsheet document discussions', () => {
  it('posts range metadata and unique user mentions through the existing document API', async () => {
    await createRoot(async (dispose) => {
      const { source, api, refresh } = setup();
      const mentions = [
        { itemType: 'user', itemId: 'alice' },
        { itemType: 'user', itemId: 'alice' },
        { itemType: 'document', itemId: 'other-doc' },
      ] as ItemMention[];
      await source.createThread('Please check this range', mentions);
      expect(api.create).toHaveBeenCalledWith({
        text: 'Please check this range',
        threadMetadata: {
          markId: expect.stringMatching(/^DISCUSSION:/),
          spreadsheet: anchor,
        },
        mentions: { mentionId: expect.any(String), users: ['alice'] },
      });
      expect(refresh).toHaveBeenCalledOnce();
      await source.createReply('7', 'Looks right', []);
      expect(api.create).toHaveBeenLastCalledWith({
        threadId: 7,
        text: 'Looks right',
        mentions: undefined,
      });
      expect(source.buildCommentLink?.(comment)).toContain('comment_id=42');
      dispose();
    });
  });
  it('allows commenters without requiring edit permission, and blocks revoked permissions and other authors', async () => {
    await createRoot(async (dispose) => {
      const { source, api, setCanComment } = setup();
      await source.editComment(comment, 'Updated');
      expect(api.edit).toHaveBeenCalledWith(42, 7, 'Updated');
      expect(() =>
        source.deleteComment({ ...comment, authorId: 'other' })
      ).toThrow(/own comments/);
      setCanComment(false);
      await expect(source.createThread('no', [])).rejects.toThrow(/permission/);
      await expect(source.createReply('7', 'no', [])).rejects.toThrow(
        /permission/
      );
      await expect(source.editComment(comment, 'no')).rejects.toThrow(
        /permission/
      );
      await expect(source.deleteComment(comment)).rejects.toThrow(/permission/);
      expect(api.create).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
      dispose();
    });
  });
  it('propagates write failures so drafts survive and does not retry a successful post after a read failure', async () => {
    await createRoot(async (dispose) => {
      const { source, api, refresh } = setup();
      api.create.mockRejectedValueOnce(new Error('offline'));
      await expect(source.createThread('Keep my draft', [])).rejects.toThrow(
        'offline'
      );
      expect(refresh).not.toHaveBeenCalled();
      refresh.mockRejectedValueOnce(new Error('read failed'));
      await expect(
        source.createThread('Sent once', [])
      ).resolves.toBeUndefined();
      expect(api.create).toHaveBeenCalledTimes(2);
      dispose();
    });
  });
  it('updates live threads without remounting reply composers; deleted threads disappear', () =>
    createRoot((dispose) => {
      const { source, setThreads, setTarget } = setup();
      const first = source.threads()[0];
      setThreads([
        {
          ...server,
          comments: [
            ...server.comments,
            {
              commentId: 43,
              threadId: 7,
              owner: 'other',
              sender: 'sender',
              text: 'Reply',
              order: 1,
            },
          ],
        },
      ]);
      expect(source.threads()[0]).toBe(first);
      expect(first.comments.map((c) => c.authorId)).toEqual(['me', 'sender']);
      setTarget('43');
      expect(source.targetCommentId()).toBe('43');
      setThreads([
        { ...server, thread: { ...server.thread, deletedAt: 'today' } },
      ]);
      expect(source.threads()).toEqual([]);
      dispose();
    }));
  it('sorts roots before replies and preserves deletion and sender information', () => {
    const thread = spreadsheetDiscussionThread({
      ...server,
      comments: [
        {
          commentId: 43,
          threadId: 7,
          owner: 'owner',
          sender: 'sender',
          text: '',
          order: 1,
          deletedAt: 'today',
        },
        ...server.comments,
      ],
    });
    expect(thread.comments.map((c) => c.id)).toEqual(['42', '43']);
    expect(thread.comments[1].deletedAt).toBe('today');
  });
  it('accepts validated range anchors and ignores foreign/malformed annotation metadata', () => {
    expect(spreadsheetCommentAnchor({ spreadsheet: anchor })).toEqual(anchor);
    for (const metadata of [
      null,
      {},
      { markId: 'DISCUSSION:old' },
      { spreadsheet: { ...anchor, range: 'A0' } },
      { spreadsheet: { ...anchor, range: 'A1:B2:C3' } },
      { spreadsheet: { ...anchor, range: '=NOW()' } },
      { spreadsheet: { ...anchor, sheetId: 10 } },
    ])
      expect(spreadsheetCommentAnchor(metadata)).toBeUndefined();
  });
});
