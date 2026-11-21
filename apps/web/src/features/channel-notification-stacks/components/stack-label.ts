import { t } from '@app/lib/i18n';
import { match } from 'ts-pattern';
import type { ChannelStack } from '../core/channel-stacks';

/** Resolves a sender's short name, or nothing while it is unknown. */
export type SenderName = (userId: string) => string | undefined;

/**
 * What a stack says in the gutter: "New messages from Rahul and 3 others",
 * "Thread reply from Teo", "Jonah mentioned you". Read inside a reactive
 * scope, so it follows the language and names as they load.
 */
export function stackLabel(stack: ChannelStack, senderName: SenderName) {
  const names = stack.senderIds.map(
    (id) => senderName(id) || t('channelNotificationStacks.someone')
  );
  const [first = t('channelNotificationStacks.someone'), second] = names;
  const count = stack.notifications.length;

  return match(stack.kind)
    .with('mention', () =>
      t('channelNotificationStacks.mentioned', { name: first })
    )
    .with('thread', () => {
      if (stack.mentionsViewer) {
        const mentioner = stack.notifications.find(
          (notification) =>
            notification.notification_metadata.tag === 'channel_mention'
        )?.sender_id;
        return t('channelNotificationStacks.mentionedInThread', {
          // Never another sender's name for the mention.
          name:
            (mentioner && senderName(mentioner)) ||
            t('channelNotificationStacks.someone'),
        });
      }
      if (names.length <= 1) {
        return t('channelNotificationStacks.repliesFromOne', {
          name: first,
          count,
        });
      }
      if (names.length === 2 && second) {
        return t('channelNotificationStacks.repliesFromTwo', { first, second });
      }
      return t('channelNotificationStacks.repliesFromMany', {
        name: first,
        count: names.length - 1,
      });
    })
    .with('messages', () => {
      if (names.length <= 1) {
        return t('channelNotificationStacks.messagesFromOne', {
          name: first,
          count,
        });
      }
      if (names.length === 2 && second) {
        return t('channelNotificationStacks.messagesFromTwo', {
          first,
          second,
        });
      }
      return t('channelNotificationStacks.messagesFromMany', {
        name: first,
        count: names.length - 1,
      });
    })
    .exhaustive();
}
