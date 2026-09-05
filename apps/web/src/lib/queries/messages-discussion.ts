import type {
  DiscussionComment,
  DiscussionSource,
} from '@core/comments/discussion';
import {
  messageAttachments,
  messageMentions,
  messageToDiscussionThread,
} from '@core/comments/discussion/messageAdapter';
import {
  entityMessagesClient,
  type MessageParent,
} from '@service-storage/messages';
import type { Accessor } from 'solid-js';
import {
  messageActions,
  useMessageLink,
  useMessageThreadsQuery,
  useMessageTyping,
} from './messages';

export function createMessageDiscussionSource(options: {
  parent: Accessor<MessageParent>;
  canEdit: Accessor<boolean>;
  includeAnchored?: boolean;
  canManageThreads?: Accessor<boolean>;
  currentUserId: Accessor<string | undefined>;
  targetCommentId?: Accessor<string | null>;
  buildCommentLink?: (comment: DiscussionComment) => string;
}): DiscussionSource {
  const query = useMessageThreadsQuery(options.parent);
  const actions = messageActions(options.parent);
  const typingUsers = useMessageTyping(options.parent, options.currentUserId);
  const targetCommentId = useMessageLink(
    options.parent,
    () => options.targetCommentId?.() ?? null
  );
  return {
    threads: () =>
      query.isSuccess
        ? query.data
            .filter((thread) => options.includeAnchored || !thread.state.anchor)
            .map(messageToDiscussionThread)
        : [],
    canEdit: options.canEdit,
    currentUserId: options.currentUserId,
    targetCommentId,
    attachmentMode: 'files',
    typingUsers,
    isLoading: () => query.isPending,
    error: () => (query.isError ? 'Could not load comments.' : null),
    retry: () => {
      void query.refetch();
    },
    canDeleteThread: (thread) =>
      (query.isSuccess &&
        query.data.find((item) => item.state.root_id === thread.id)?.state
          .user_id === options.currentUserId()) ||
      (options.canManageThreads?.() ?? false),
    typing: (threadId, active) => {
      void entityMessagesClient
        .typing(options.parent(), threadId, active)
        .catch(() => {});
    },
    buildCommentLink: options.buildCommentLink,
    async createThread(text, mentions, attachments) {
      await actions.post({
        content: text,
        mentions: messageMentions(mentions),
        attachments: messageAttachments(attachments),
      });
    },
    async createReply(threadId, text, mentions, attachments) {
      await actions.post({
        content: text,
        thread_id: threadId,
        mentions: messageMentions(mentions),
        attachments: messageAttachments(attachments),
      });
    },
    async editComment(comment, text, mentions = [], attachments) {
      await actions.edit(comment.id, {
        content: text,
        mentions: messageMentions(mentions),
        attachments: attachments ? messageAttachments(attachments) : undefined,
      });
    },
    async deleteComment(comment) {
      await actions.delete(comment.id);
    },
    async react(comment, emoji) {
      const active = !comment.reactions
        ?.find((reaction) => reaction.emoji === emoji)
        ?.users.includes(options.currentUserId() ?? '');
      await actions.react(comment.id, emoji, active);
    },
    async resolveThread(id, resolved) {
      await actions.resolve(id, resolved);
    },
    async deleteThread(id) {
      await actions.deleteThread(id);
    },
  };
}
