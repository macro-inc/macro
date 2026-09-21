import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { Message, MessageThread } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { spreadsheetCommentAnchor } from '../core/spreadsheet-comments';
import {
  createSpreadsheetDiscussion,
  spreadsheetDiscussionThread,
} from './create-spreadsheet-discussion';

const anchor = { sheetId: 'sheet-1', sheetName: 'Budget', range: 'B4:C9' };
const threadAnchor = {
  type: 'spreadsheet',
  sheet_id: 'sheet-1',
  sheet_name: 'Budget',
  range: 'B4:C9',
} as const;
const parent = { type: 'document', id: 'doc' } as const;
function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    parent,
    thread_id: null,
    sender_id: 'me',
    content: 'Budget?',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    mentions: [],
    attachments: [],
    reactions: [],
    ...overrides,
  };
}
const comment = {
  id: 'root-7',
  threadId: 'root-7',
  authorId: 'me',
  text: 'Budget?',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  deletedAt: null,
};
const server: MessageThread = {
  state: {
    root_id: 'root-7',
    user_id: 'me',
    resolved: false,
    anchor: threadAnchor,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  root: message({ id: 'root-7' }),
  replies: [],
};
function setup() {
  const [canComment, setCanComment] = createSignal(true);
  const [threads, setThreads] = createSignal([server]);
  const [target, setTarget] = createSignal<string | null>(null);
  const api = {
    create: vi.fn(async () => message({ id: 'created' })),
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
  it('posts the range anchor and unique authored mentions through the message API', async () => {
    await createRoot(async (dispose) => {
      const { source, api, refresh } = setup();
      const mentions = [
        { itemType: 'user', itemId: 'macro|alice@example.com' },
        { itemType: 'user', itemId: 'macro|alice@example.com' },
        { itemType: 'document', itemId: 'other-doc' },
        { itemType: 'date', itemId: '2026-01-01' },
      ] as ItemMention[];
      await source.createThread('Please check this range', mentions);
      expect(api.create).toHaveBeenCalledWith({
        content: 'Please check this range',
        anchor: threadAnchor,
        mentions: [
          { entity_type: 'user', entity_id: 'macro|alice@example.com' },
          { entity_type: 'document', entity_id: 'other-doc' },
        ],
      });
      expect(refresh).toHaveBeenCalledOnce();
      await source.createReply('root-7', 'Looks right', []);
      expect(api.create).toHaveBeenLastCalledWith({
        content: 'Looks right',
        thread_id: 'root-7',
        mentions: [],
      });
      expect(source.buildCommentLink?.(comment)).toContain('comment_id=root-7');
      dispose();
    });
  });
  it('posts a workbook comment without an anchor when no range is selected', async () => {
    await createRoot(async (dispose) => {
      const [threads] = createSignal([server]);
      const api = {
        create: vi.fn(async () => message({ id: 'created' })),
        edit: vi.fn(async () => ({})),
        delete: vi.fn(async () => ({})),
      };
      const source = createSpreadsheetDiscussion({
        threads,
        canComment: () => true,
        userId: () => 'me',
        anchor: () => undefined,
        targetCommentId: () => null,
        targetRevision: () => null,
        api,
        refresh: async () => {},
        buildLink: (id) => id,
      });
      await source.createThread('Whole workbook', []);
      expect(api.create).toHaveBeenCalledWith({
        content: 'Whole workbook',
        mentions: [],
      });
      dispose();
    });
  });
  it('allows commenters without requiring edit permission, and blocks revoked permissions and other authors', async () => {
    await createRoot(async (dispose) => {
      const { source, api, setCanComment } = setup();
      await source.editComment(comment, 'Updated');
      expect(api.edit).toHaveBeenCalledWith('root-7', 'Updated', []);
      expect(() =>
        source.deleteComment({ ...comment, authorId: 'other' })
      ).toThrow(/own comments/);
      setCanComment(false);
      await expect(source.createThread('no', [])).rejects.toThrow(/permission/);
      await expect(source.createReply('root-7', 'no', [])).rejects.toThrow(
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
          replies: [
            message({
              id: 'reply-8',
              thread_id: 'root-7',
              sender_id: 'other',
              content: 'Reply',
            }),
          ],
        },
      ]);
      expect(source.threads()[0]).toBe(first);
      expect(first.comments.map((c) => c.authorId)).toEqual(['me', 'other']);
      setTarget('reply-8');
      expect(source.targetCommentId()).toBe('reply-8');
      setThreads([
        { ...server, state: { ...server.state, deleted_at: 'today' } },
      ]);
      expect(source.threads()).toEqual([]);
      dispose();
    }));
  it('keeps the root first and preserves deletion, edit, and sender information', () => {
    const thread = spreadsheetDiscussionThread({
      ...server,
      state: { ...server.state, resolved: true },
      replies: [
        message({
          id: 'reply-8',
          thread_id: 'root-7',
          sender_id: 'sender',
          content: '',
          deleted_at: 'today',
        }),
        message({
          id: 'reply-9',
          thread_id: 'root-7',
          content: 'Edited',
          updated_at: '2026-01-02T00:00:00Z',
        }),
      ],
    });
    expect(thread.resolved).toBe(true);
    expect(thread.comments.map((c) => c.id)).toEqual([
      'root-7',
      'reply-8',
      'reply-9',
    ]);
    expect(thread.comments.map((c) => c.threadId)).toEqual([
      'root-7',
      'root-7',
      'root-7',
    ]);
    expect(thread.comments[1]).toMatchObject({
      authorId: 'sender',
      deletedAt: 'today',
    });
    expect(thread.comments[2].updatedAt).toBe('2026-01-02T00:00:00Z');
  });
  it('accepts validated range anchors and ignores other or malformed anchors', () => {
    expect(spreadsheetCommentAnchor(threadAnchor)).toEqual(anchor);
    for (const value of [
      null,
      undefined,
      { type: 'markdown', mark_id: '01990000-0000-7000-8000-000000000002' },
      { ...threadAnchor, range: 'A0' },
      { ...threadAnchor, range: 'A1:B2:C3' },
      { ...threadAnchor, range: '=NOW()' },
      { ...threadAnchor, sheet_id: '' },
    ])
      expect(
        spreadsheetCommentAnchor(
          value as Parameters<typeof spreadsheetCommentAnchor>[0]
        )
      ).toBeUndefined();
  });
});
