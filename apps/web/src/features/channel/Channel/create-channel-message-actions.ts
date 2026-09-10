import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import { getWebOrigin } from '@core/util/webOrigin';
import type { MessageParent } from '@service-storage/messages';
import type { Accessor } from 'solid-js';
import type {
  MessageActionHandler,
  MessageActions,
  MessageData,
} from '../Message';
import {
  buildMessageLink,
  canDeleteMessage,
  canEditMessage,
  canReplyToMessage,
  DEFAULT_REACTION_EMOJI,
  hasReactionFromUser,
} from '../Thread/utils/message-actions';

type AddReactionInput = {
  parent: MessageParent;
  messageId: string;
  emoji: string;
  userId: string;
  threadId?: string;
  currentReactions: MessageData['reactions'];
};

type RemoveReactionInput = {
  parent: MessageParent;
  messageId: string;
  emoji: string;
  userId: string;
  threadId?: string;
  currentReactions: MessageData['reactions'];
};

export type DeleteMessageInput = {
  parent: MessageParent;
  messageID: string;
  threadID?: string;
};

type ChannelMessageActionEffects = {
  getLocationHref: () => string;
  copyToClipboard: (text: string) => Promise<void>;
  notifyCopyLinkSuccess: () => void;
  notifyCopyLinkFailure: (error: unknown) => void;
  notifyCopyMessageTextSuccess: () => void;
  notifyCopyMessageTextFailure: (error: unknown) => void;
};

export type CreateChannelMessageActionsOptions = {
  parent: Accessor<MessageParent>;
  userId: Accessor<string | undefined>;
  canWrite?: (message: MessageData) => boolean;
  buildLink?: (message: MessageData) => string;
  deleteMessage: (input: DeleteMessageInput) => void;
  addReaction: (input: AddReactionInput) => void;
  removeReaction: (input: RemoveReactionInput) => void;
  onReply?: MessageActionHandler;
  onEdit?: MessageActionHandler;
  onCreateTask?: MessageActionHandler;
  onChat?: MessageActionHandler;
  effects?: Partial<ChannelMessageActionEffects>;
};

function createDefaultEffects(): ChannelMessageActionEffects {
  return {
    getLocationHref: () =>
      getWebOrigin() +
      window.location.pathname +
      window.location.search +
      window.location.hash,
    copyToClipboard: (text) => navigator.clipboard.writeText(text),
    notifyCopyLinkSuccess: () => {
      toast.success('Link copied to clipboard');
    },
    notifyCopyLinkFailure: (error) => {
      console.error('failed to copy link', error);
      toast.failure('Failed to copy link');
    },
    notifyCopyMessageTextSuccess: () => {
      toast.success('Message copied to clipboard');
    },
    notifyCopyMessageTextFailure: (error) => {
      console.error('failed to copy message text', error);
      toast.failure('Failed to copy message');
    },
  };
}

const emptyReplyHandler: MessageActionHandler = () => undefined;

export function createChannelMessageActions(
  options: CreateChannelMessageActionsOptions
): (message: MessageData) => MessageActions {
  const analytics = useAnalytics();

  const effects = {
    ...createDefaultEffects(),
    ...options.effects,
  };

  return (message) => {
    const currentUserId = options.userId();
    const writable = options.canWrite?.(message) ?? true;
    const canEdit = writable && canEditMessage(message, currentUserId);
    const canDelete = writable && canDeleteMessage(message, currentUserId);
    const canReply = writable && canReplyToMessage(message);
    const isDeleted = !!message.deleted_at;

    return {
      onReply: canReply ? (options.onReply ?? emptyReplyHandler) : undefined,
      onReact:
        writable && !isDeleted
          ? (ctx) => {
              const userId = options.userId();
              if (!userId) return;

              const emoji = ctx.emoji ?? DEFAULT_REACTION_EMOJI;
              const parent = message.parent ?? options.parent();
              const targetMessage = message;
              const liveMessage = ctx.message;
              const threadId =
                (targetMessage as MessageData & { thread_id?: string | null })
                  .thread_id ?? undefined;
              const hasReaction = hasReactionFromUser(
                liveMessage,
                emoji,
                userId
              );

              analytics.track('channel_reaction', {
                emoji,
                action: hasReaction ? 'remove' : 'add',
              });

              if (hasReaction) {
                options.removeReaction({
                  parent,
                  messageId: targetMessage.id,
                  emoji,
                  userId,
                  threadId,
                  currentReactions: liveMessage.reactions,
                });
                return;
              }

              options.addReaction({
                parent,
                messageId: targetMessage.id,
                emoji,
                userId,
                threadId,
                currentReactions: liveMessage.reactions,
              });
            }
          : undefined,
      onCopyLink: async () => {
        try {
          const parent = message.parent ?? options.parent();
          const url =
            options.buildLink?.(message) ??
            buildMessageLink(parent.id, message.id, message.thread_id);
          await effects.copyToClipboard(url);
          effects.notifyCopyLinkSuccess();
        } catch (error) {
          effects.notifyCopyLinkFailure(error);
        }
      },
      onCopyMessageText:
        !isDeleted && message.content
          ? async () => {
              try {
                await effects.copyToClipboard(message.content);
                effects.notifyCopyMessageTextSuccess();
              } catch (error) {
                effects.notifyCopyMessageTextFailure(error);
              }
            }
          : undefined,
      onEdit: canEdit ? options.onEdit : undefined,
      onDelete: canDelete
        ? () => {
            options.deleteMessage({
              parent: message.parent ?? options.parent(),
              messageID: message.id,
              threadID:
                (message as MessageData & { thread_id?: string | null })
                  .thread_id ?? undefined,
            });
          }
        : undefined,
      onCreateTask: options.onCreateTask,
      onChat: !isDeleted ? options.onChat : undefined,
    };
  };
}
