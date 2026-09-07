import { buildMessageLink } from '@channel/Thread/utils/message-actions';
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
import { type Accessor, createSignal } from 'solid-js';
import {
  messageActions,
  useChannelReferenceThreadsQuery,
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
  const [includeChannelReferences, setIncludeChannelReferences] =
    createSignal(false);
  const references = useChannelReferenceThreadsQuery(
    options.parent,
    includeChannelReferences
  );
  const referenceThreads = () =>
    includeChannelReferences() && references.isSuccess ? references.data : [];
  const referenceFor = (id: string) =>
    referenceThreads().find((item) => item.thread.state.root_id === id);
  const parentForThread = (id: string) =>
    referenceFor(id)?.thread.root.parent ?? options.parent();
  const threadActions = (id: string) =>
    messageActions(() => parentForThread(id));
  const commentActions = (comment: DiscussionComment) =>
    messageActions(() => comment.parent ?? options.parent());
  const refreshReferences = () => {
    if (includeChannelReferences()) void references.refetch();
  };

  const typingUsers = useMessageTyping(options.parent, options.currentUserId);
  const targetCommentId = useMessageLink(
    options.parent,
    () => options.targetCommentId?.() ?? null
  );
  return {
    messageParent: options.parent,
    channelReferences:
      options.parent().type === 'document'
        ? {
            enabled: includeChannelReferences,
            setEnabled: setIncludeChannelReferences,
          }
        : undefined,
    threads: () =>
      [
        ...(query.isSuccess
          ? query.data
              .filter(
                (thread) => options.includeAnchored || !thread.state.anchor
              )
              .map(messageToDiscussionThread)
          : []),
        ...referenceThreads().map((item) => ({
          ...messageToDiscussionThread(item.thread),
          sourceLabel: item.channel_name || 'Channel conversation',
          sourceHref: buildMessageLink(
            item.thread.root.parent.id,
            item.thread.root.id
          ),
        })),
      ].sort(
        (a, b) =>
          (a.comments[0]?.createdAt ?? '').localeCompare(
            b.comments[0]?.createdAt ?? ''
          ) || a.id.localeCompare(b.id)
      ),
    canReply: (thread) =>
      thread.parent?.type === 'channel'
        ? (referenceFor(thread.id)?.can_reply ?? false)
        : options.canEdit(),
    canEdit: options.canEdit,
    currentUserId: options.currentUserId,
    targetCommentId,
    attachmentMode: 'files',
    typingUsers,
    isLoading: () =>
      query.isPending || (includeChannelReferences() && references.isPending),
    error: () =>
      query.isError
        ? 'Could not load comments.'
        : includeChannelReferences() && references.isError
          ? 'Could not load channel mentions.'
          : null,
    retry: () => {
      void query.refetch();
      refreshReferences();
    },
    canDeleteThread: (thread) =>
      thread.parent?.type !== 'channel' &&
      ((query.isSuccess &&
        query.data.find((item) => item.state.root_id === thread.id)?.state
          .user_id === options.currentUserId()) ||
        (options.canManageThreads?.() ?? false)),
    typing: (threadId, active) => {
      void entityMessagesClient
        .typing(parentForThread(threadId), threadId, active)
        .catch(() => {});
    },
    buildCommentLink: (comment) =>
      comment.parent?.type === 'channel'
        ? buildMessageLink(
            comment.parent.id,
            comment.id,
            comment.id === comment.threadId ? null : comment.threadId
          )
        : options.buildCommentLink?.(comment),
    async createThread(text, mentions, attachments) {
      await actions.post({
        content: text,
        mentions: messageMentions(mentions),
        attachments: messageAttachments(attachments),
      });
    },
    async createReply(threadId, text, mentions, attachments) {
      await threadActions(threadId).post({
        content: text,
        thread_id: threadId,
        mentions: messageMentions(mentions),
        attachments: messageAttachments(attachments),
      });
      refreshReferences();
    },
    async editComment(comment, text, mentions = [], attachments) {
      await commentActions(comment).edit(comment.id, {
        content: text,
        mentions: messageMentions(mentions),
        attachments: attachments ? messageAttachments(attachments) : undefined,
      });
      refreshReferences();
    },
    async deleteComment(comment) {
      await commentActions(comment).delete(comment.id);
      refreshReferences();
    },
    async react(comment, emoji) {
      const active = !comment.reactions
        ?.find((reaction) => reaction.emoji === emoji)
        ?.users.includes(options.currentUserId() ?? '');
      await commentActions(comment).react(comment.id, emoji, active);
      refreshReferences();
    },
    async resolveThread(id, resolved) {
      await actions.resolve(id, resolved);
    },
    async deleteThread(id) {
      await actions.deleteThread(id);
    },
  };
}
