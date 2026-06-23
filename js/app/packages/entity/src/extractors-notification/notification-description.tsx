import type { NotificationType } from '@core/types';
import { tryMacroId, useDisplayNameParts } from '@core/user';
import type { NotificationStack } from '@notifications';
import { createMemo } from 'solid-js';
import type { Notification } from '../types/notification';
import {
  getActionVerb,
  getGithubSenderLogin,
  getTypeNoun,
  getTypePreposition,
  getUniqueGithubLogins,
  getUniqueSenderIds,
} from './notification-description-helpers';

// Re-export helpers for backward compatibility and testing

interface NotificationDescriptionProps {
  notification?: Notification;
  stack?: NotificationStack;
}

/**
 * Displays a complete description of the notification including sender(s) and action
 *
 * Formats:
 * - Single notification: "Peter mentioned you"
 * - Stack with one sender: "Peter: 13 messages"
 * - Stack with multiple senders: "13 messages from Peter +5"
 */
export function NotificationDescription(props: NotificationDescriptionProps) {
  const isSingleNotification = () => {
    return Boolean(
      props.notification ||
        (props.stack && props.stack.notifications.length === 1)
    );
  };

  const notificationType = (): NotificationType | undefined => {
    if (props.notification) return props.notification.notification_metadata.tag;
    if (props.stack) return props.stack.type;
    return undefined;
  };

  const count = () => {
    if (props.stack) return props.stack.notifications.length;
    return 1;
  };

  const macroFirstName = (id: string) => {
    const parts = useDisplayNameParts(tryMacroId(id), {
      emailFallback: 'local-part',
    });
    return parts.firstName() || parts.fullName();
  };

  // Sender display labels for the notification/stack. Macro senders resolve to
  // their display name; GitHub PR senders (who usually aren't Macro users and so
  // have no `sender_id`) fall back to the GitHub login carried in the
  // notification metadata.
  // Memoized so the per-sender name resolution (which has side effects: it
  // queues a fetch and registers a reactive effect) runs once per dependency
  // change rather than on every call from the description() formatters.
  const senderLabels = createMemo((): string[] => {
    if (props.notification) {
      if (props.notification.sender_id) {
        return [macroFirstName(props.notification.sender_id)];
      }
      const login = getGithubSenderLogin(props.notification);
      return login ? [login] : [];
    }
    if (props.stack) {
      const macroIds = getUniqueSenderIds(props.stack.notifications);
      if (macroIds.length > 0) {
        return macroIds.map(macroFirstName);
      }
      return getUniqueGithubLogins(props.stack.notifications);
    }
    return [];
  });

  const primarySenderLabel = () => senderLabels()[0];
  const secondarySenderLabel = () => senderLabels()[1];
  const additionalSenderCount = () => Math.max(0, senderLabels().length - 1);
  const hasMultipleSenders = () => additionalSenderCount() > 0;

  const description = () => {
    const type = notificationType();
    const sender = primarySenderLabel();

    if (!type) return '';

    // Single notification: "Peter mentioned you"
    if (isSingleNotification()) {
      if (sender && type !== 'ai_response') {
        return `${sender} ${getActionVerb(type)}`;
      }
      return getActionVerb(type);
    }

    // Stack with multiple senders
    if (hasMultipleSenders()) {
      const senderCount = senderLabels().length;
      if (senderCount === 2) {
        return `${count()} ${getTypeNoun(type, count())} ${getTypePreposition(type)} ${sender} and ${secondarySenderLabel()}`;
      }
      // Three or more senders: "13 messages from Peter and 5 others"
      return `${count()} ${getTypeNoun(type, count())} ${getTypePreposition(type)} ${sender} and ${additionalSenderCount()} ${additionalSenderCount() === 1 ? 'other' : 'others'}`;
    }

    // Stack with single sender: "Peter: 13 messages"
    if (sender) {
      return `${sender}: ${count()} ${getTypeNoun(type, count())}`;
    }
    return `${count()} ${getTypeNoun(type, count())}`;
  };

  return <>{description()}</>;
}
