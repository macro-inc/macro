import { toast } from '@core/component/Toast/Toast';
import { getWebOrigin } from '@core/util/webOrigin';
import type { Accessor } from 'solid-js';
import type {
  MessageActionHandler,
  MessageActions,
  MessageData,
} from '../Message';
import {
  buildMessageLink,
  canEditOrDeleteMessage,
  canReplyToMessage,
  DEFAULT_REACTION_EMOJI,
  hasReactionFromUser,
} from '../Thread/utils/message-actions';
import { useAnalytics } from '@app/component/analytics-context';

type AddReactionInput = {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
  threadId?: string;
  currentReactions: MessageData['reactions'];
};

type RemoveReactionInput = {
  channelId: string;
  messageId: string;
  emoji: string;
  userId: string;
  threadId?: string;
  currentReactions: MessageData['reactions'];
};

type DeleteMessageInput = {
  channelID: string;
  messageID: string;
  threadID?: string;
};

type ChannelMessageActionEffects = {
  getLocationHref: () => string;
  copyToClipboard: (text: string) => Promise<void>;
  notifyCopyLinkSuccess: () => void;
  notifyCopyLinkFailure: (error: unknown) => void;
};

export type CreateChannelMessageActionsOptions = {
  channelId: Accessor<string>;
  userId: Accessor<string | undefined>;
  deleteMessage: (input: DeleteMessageInput) => void;
  addReaction: (input: AddReactionInput) => void;
  removeReaction: (input: RemoveReactionInput) => void;
  onReply?: MessageActionHandler;
  onEdit?: MessageActionHandler;
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
    const canEditDelete = canEditOrDeleteMessage(message, currentUserId);
    const canReply = canReplyToMessage(message);
    const isDeleted = !!message.deleted_at;

    return {
      onReply: canReply ? (options.onReply ?? emptyReplyHandler) : undefined,
      onReact: !isDeleted
        ? (ctx) => {
            const userId = options.userId();
            if (!userId) return;

            const emoji = ctx.emoji ?? DEFAULT_REACTION_EMOJI;
            const channelId = options.channelId();
            const targetMessage = message;
            const liveMessage = ctx.message;
            const threadId =
              (targetMessage as MessageData & { thread_id?: string | null })
                .thread_id ?? undefined;
            const hasReaction = hasReactionFromUser(liveMessage, emoji, userId);

            analytics.track('channel_reaction', {
              emoji,
              action: hasReaction ? 'remove' : 'add',
            });

            if (hasReaction) {
              options.removeReaction({
                channelId,
                messageId: targetMessage.id,
                emoji,
                userId,
                threadId,
                currentReactions: liveMessage.reactions,
              });
              return;
            }

            options.addReaction({
              channelId,
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
          const channelId = options.channelId();
          const url = buildMessageLink(
            channelId,
            message.id,
            message.thread_id
          );
          await effects.copyToClipboard(url);
          effects.notifyCopyLinkSuccess();
        } catch (error) {
          effects.notifyCopyLinkFailure(error);
        }
      },
      onEdit: canEditDelete ? options.onEdit : undefined,
      onDelete: canEditDelete
        ? () => {
            options.deleteMessage({
              channelID: options.channelId(),
              messageID: message.id,
              threadID:
                (message as MessageData & { thread_id?: string | null })
                  .thread_id ?? undefined,
            });
          }
        : undefined,
    };
  };
}
