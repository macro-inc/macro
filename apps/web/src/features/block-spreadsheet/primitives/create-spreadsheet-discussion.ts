import type {
  DiscussionSource,
  DiscussionThread,
} from '@core/comments/discussion/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import type { CreateCommentRequest } from '@service-storage/generated/schemas/createCommentRequest';
import { type Accessor, createMemo } from 'solid-js';
import type { SpreadsheetCommentAnchor } from '../core/spreadsheet-comments';

export function createSpreadsheetDiscussion(options: {
  threads: Accessor<CommentThread[]>;
  canComment: Accessor<boolean>;
  userId: Accessor<string | undefined>;
  anchor: Accessor<SpreadsheetCommentAnchor | undefined>;
  targetCommentId: Accessor<string | null>;
  targetRevision: Accessor<unknown>;
  api: {
    create(body: CreateCommentRequest): Promise<unknown>;
    edit(commentId: number, threadId: number, text: string): Promise<unknown>;
    delete(commentId: number): Promise<unknown>;
  };
  refresh(): Promise<unknown>;
  buildLink(commentId: string): string;
}): DiscussionSource {
  // Keep each thread's UI mounted when a live reply arrives while composing.
  const adapters = new Map<
    string,
    ReturnType<typeof spreadsheetDiscussionThread>
  >();
  const mapped = createMemo(
    () =>
      new Map(
        options
          .threads()
          .filter((value) => !value.thread.deletedAt)
          .map((value) => [
            String(value.thread.threadId),
            spreadsheetDiscussionThread(value),
          ])
      )
  );
  const threads = createMemo(() =>
    [...mapped().keys()].map((id) => {
      let adapter = adapters.get(id);
      if (!adapter) {
        adapter = {
          id,
          get resolved() {
            return mapped().get(id)?.resolved ?? false;
          },
          get comments() {
            return mapped().get(id)?.comments ?? [];
          },
        };
        adapters.set(id, adapter);
      }
      return adapter;
    })
  );
  async function write(operation: () => Promise<unknown>) {
    if (!options.canComment() || !options.userId())
      throw new Error('You do not have permission to comment.');
    await operation();
    // Posting succeeded even if refreshing later fails. Never invite duplicate sends.
    void options.refresh().catch(() => {});
  }
  function assertOwner(authorId: string) {
    if (authorId !== options.userId())
      throw new Error('You can only change your own comments.');
  }
  return {
    threads,
    canEdit: options.canComment,
    currentUserId: options.userId,
    targetCommentId: options.targetCommentId,
    targetRevision: options.targetRevision,
    createThread: (text, mentions) => {
      const anchor = options.anchor();
      return write(() =>
        options.api.create({
          text,
          threadMetadata: {
            markId: `DISCUSSION:${crypto.randomUUID()}`,
            ...(anchor ? { spreadsheet: anchor } : {}),
          },
          mentions: spreadsheetCommentMentions(mentions),
        })
      );
    },
    createReply: (threadId, text, mentions) =>
      write(() =>
        options.api.create({
          text,
          threadId: Number(threadId),
          mentions: spreadsheetCommentMentions(mentions),
        })
      ),
    editComment: (comment, text) => {
      assertOwner(comment.authorId);
      return write(() =>
        options.api.edit(Number(comment.id), Number(comment.threadId), text)
      );
    },
    deleteComment: (comment) => {
      assertOwner(comment.authorId);
      return write(() => options.api.delete(Number(comment.id)));
    },
    buildCommentLink: (comment) => options.buildLink(comment.id),
  };
}

export function spreadsheetCommentMentions(mentions: ItemMention[]) {
  const users = [
    ...new Set(
      mentions
        .filter((item) => item.itemType === 'user')
        .map((item) => item.itemId)
    ),
  ];
  return users.length ? { mentionId: crypto.randomUUID(), users } : undefined;
}

export function spreadsheetDiscussionThread(
  value: CommentThread
): DiscussionThread {
  return {
    id: String(value.thread.threadId),
    resolved: value.thread.resolved,
    comments: [...value.comments]
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) -
            (b.order ?? Number.MAX_SAFE_INTEGER) ||
          (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
          a.commentId - b.commentId
      )
      .map((comment) => ({
        id: String(comment.commentId),
        threadId: String(comment.threadId),
        authorId: comment.sender ?? comment.owner,
        text: comment.text,
        createdAt: comment.createdAt ?? '',
        updatedAt: comment.updatedAt ?? comment.createdAt ?? '',
        deletedAt: comment.deletedAt ?? null,
      })),
  };
}
