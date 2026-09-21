import { authoredMentions } from '@channel/Input/message-payload';
import type {
  DiscussionSource,
  DiscussionThread,
} from '@core/comments/discussion/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { SimpleMention } from '@service-storage/generated/schemas/simpleMention';
import type {
  Message,
  MessageThread,
  PostMessage,
} from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';
import {
  type SpreadsheetCommentAnchor,
  spreadsheetThreadAnchor,
} from '../core/spreadsheet-comments';

export function createSpreadsheetDiscussion(options: {
  threads: Accessor<MessageThread[]>;
  canComment: Accessor<boolean>;
  userId: Accessor<string | undefined>;
  anchor: Accessor<SpreadsheetCommentAnchor | undefined>;
  targetCommentId: Accessor<string | null>;
  targetRevision: Accessor<unknown>;
  api: {
    create(input: PostMessage): Promise<Message>;
    edit(
      messageId: string,
      content: string,
      mentions: SimpleMention[]
    ): Promise<unknown>;
    delete(messageId: string): Promise<unknown>;
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
          .filter((value) => !value.state.deleted_at)
          .map((value) => [
            value.state.root_id,
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
          content: text,
          mentions: spreadsheetCommentMentions(mentions),
          ...(anchor ? { anchor: spreadsheetThreadAnchor(anchor) } : {}),
        })
      );
    },
    createReply: (threadId, text, mentions) =>
      write(() =>
        options.api.create({
          content: text,
          thread_id: threadId,
          mentions: spreadsheetCommentMentions(mentions),
        })
      ),
    editComment: (comment, text) => {
      assertOwner(comment.authorId);
      return write(() => options.api.edit(comment.id, text, []));
    },
    deleteComment: (comment) => {
      assertOwner(comment.authorId);
      return write(() => options.api.delete(comment.id));
    },
    buildCommentLink: (comment) => options.buildLink(comment.id),
  };
}

/** Mentions the composer authored, as the message API stores them. */
export function spreadsheetCommentMentions(
  mentions: ItemMention[]
): SimpleMention[] {
  return authoredMentions(mentions);
}

/** A message thread as the shared discussion UI renders it: root first, then replies. */
export function spreadsheetDiscussionThread(
  value: MessageThread
): DiscussionThread {
  return {
    id: value.state.root_id,
    resolved: value.state.resolved,
    comments: [value.root, ...value.replies].map((message) => ({
      id: message.id,
      threadId: message.thread_id ?? message.id,
      authorId: message.sender_id,
      text: message.content,
      createdAt: message.created_at,
      updatedAt: message.updated_at,
      deletedAt: message.deleted_at ?? null,
    })),
  };
}
