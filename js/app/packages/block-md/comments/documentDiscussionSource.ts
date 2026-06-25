import { useBlockAliasedName, useBlockId } from '@core/block';
import type {
  DiscussionComment,
  DiscussionSource,
  DiscussionThread,
} from '@core/comments/discussion';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { useUrlParams } from '@core/component/ParamsProvider';
import { useUserId } from '@core/context/user';
import { useCanComment } from '@core/signal/permissions';
import { buildSimpleEntityUrl } from '@core/util/url';
import type { CommentThread } from '@service-storage/generated/schemas/commentThread';
import type { CreateCommentRequestMentions } from '@service-storage/generated/schemas/createCommentRequestMentions';
import { createMemo } from 'solid-js';
import { URL_PARAMS } from '../constants';
import {
  discussionThreads,
  sortComments,
  useCreateDiscussionReply,
  useCreateDiscussionThread,
  useDeleteDiscussionComment,
  useEditDiscussionComment,
} from './discussionResource';

function buildCommentMentions(
  mentions: ItemMention[]
): CreateCommentRequestMentions | undefined {
  const userIds = mentions
    .filter((m) => m.itemType === 'user')
    .map((m) => m.itemId);
  if (userIds.length === 0) return undefined;
  return { mentionId: crypto.randomUUID(), users: userIds };
}

/** Maps a server `CommentThread` (numeric ids) to the normalized view model. */
function toViewThread(ct: CommentThread): DiscussionThread {
  const comments: DiscussionComment[] = [...ct.comments]
    .sort(sortComments)
    .map((c) => ({
      id: String(c.commentId),
      threadId: String(c.threadId),
      authorId: c.sender ?? c.owner,
      text: c.text,
      createdAt: c.createdAt ?? '',
      updatedAt: c.updatedAt ?? c.createdAt ?? '',
      deletedAt: c.deletedAt ?? null,
    }));
  return {
    id: String(ct.thread.threadId),
    resolved: ct.thread.resolved,
    comments,
  };
}

/**
 * [`DiscussionSource`] backed by the document annotations system — the
 * `DISCUSSION:`-marked threads on a markdown document. Quarantines the numeric
 * id ↔ string adaptation and the document-specific request shapes so the
 * shared discussion UI stays backend-agnostic. Must be called within a
 * block/component owner (it wires the existing block resources).
 */
export function createDocumentDiscussionSource(): DiscussionSource {
  const blockId = useBlockId();
  const blockAliasedName = useBlockAliasedName();
  // Comment affordances gate on can-comment (main switched tasks off can-edit).
  const canComment = useCanComment();
  const userId = useUserId();
  const urlParams = useUrlParams(URL_PARAMS);

  const createThreadFn = useCreateDiscussionThread();
  const createReplyFn = useCreateDiscussionReply();
  const editFn = useEditDiscussionComment();
  const deleteFn = useDeleteDiscussionComment();

  const threads = createMemo(() =>
    (discussionThreads() ?? []).map(toViewThread)
  );
  const targetCommentId = createMemo(() => urlParams.commentId() ?? null);

  return {
    threads,
    canEdit: canComment,
    currentUserId: userId,
    targetCommentId,
    async createThread(text, mentions) {
      await createThreadFn(text, buildCommentMentions(mentions));
    },
    async createReply(threadId, text, mentions) {
      await createReplyFn(
        text,
        Number(threadId),
        buildCommentMentions(mentions)
      );
    },
    async editComment(comment, text) {
      await editFn(Number(comment.id), {
        text,
        threadId: Number(comment.threadId),
      });
    },
    async deleteComment(comment) {
      await deleteFn(Number(comment.id), {});
    },
    buildCommentLink(comment) {
      return buildSimpleEntityUrl(
        { type: blockAliasedName, id: blockId },
        { [URL_PARAMS.commentId]: comment.id }
      );
    },
  };
}
