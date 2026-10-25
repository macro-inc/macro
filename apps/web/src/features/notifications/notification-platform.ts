import { getFaviconUrl } from '@app/util/favicon';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import { committedThemeAccent } from '../theme/signals/themeSignals';
import type { PlatformNotificationState } from './components/PlatformNotificationProvider';
import { isEntityDiscussionEvent } from './entity-discussion';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  shouldShowNotificationTarget,
} from './notification-metadata';
import { openNotification } from './notification-navigation';
import {
  DefaultDocumentNameResolver,
  DefaultUserAvatarResolver,
  DefaultUserNameResolver,
  type DocumentNameResolver,
  type UserAvatarResolver,
  type UserNameResolver,
} from './notification-resolvers';
import { getNotificationSenderAvatarUrl } from './notification-sender';
import type { UnifiedNotification } from './types';

/// the interface for a singular notification on this device
export interface PlatformNotificationHandle {
  onClick: (cb: () => void) => void;
  onDismiss: (cb: () => void) => void;
  close: () => void;
}

export interface PlatformNotificationSender {
  /** The sender's Macro user id, or the agent's name when it has none. */
  id: string;
  name: string;
  avatarUrl?: string;
}

export interface PlatformNotificationData {
  title: string;
  notificationId?: string;
  options?: NotificationOptions;
  /** Who it is from, for platforms that show the sender apart from `title`. */
  sender?: PlatformNotificationSender;
  /** Where it happened. `name` is set only when `title` names it too. */
  conversation?: { id: string; name?: string };
}

const USER_NAME_FALLBACK = 'Someone';
const DOCUMENT_NAME_FALLBACK = 'Something';

/**
 * Who the notification reads as being from. Agent notifications have no user
 * sender - a bot is not a user - so the bot (or, for a mention, the author)
 * named in the metadata stands in.
 */
async function resolveActorName(
  notification: UnifiedNotification,
  resolveUserName: UserNameResolver
): Promise<string | undefined> {
  const meta = notification.notification_metadata;
  if (
    meta.tag === 'agent_session_settled' ||
    meta.tag === 'agent_session_waiting_for_input'
  ) {
    return meta.content.botName;
  }
  if (isEntityDiscussionEvent(meta) && meta.content.senderDisplayName) {
    return meta.content.senderDisplayName;
  }
  if (meta.tag === 'agent_session_mentioned') {
    return meta.content.mentionedBy
      ? await resolveUserName(meta.content.mentionedBy)
      : meta.content.botName;
  }
  return notification.sender_id
    ? await resolveUserName(notification.sender_id)
    : undefined;
}

async function resolveSenderAvatarUrl(
  notification: UnifiedNotification,
  resolveUserAvatar: UserAvatarResolver
): Promise<string | undefined> {
  const avatarUrl = getNotificationSenderAvatarUrl(notification);
  if (avatarUrl) return avatarUrl;
  return notification.sender_id
    ? await resolveUserAvatar(notification.sender_id)
    : undefined;
}

export async function toPlatformNotificationData(
  notification: UnifiedNotification,
  resolveUserName: UserNameResolver,
  resolveDocumentName: DocumentNameResolver,
  resolveUserAvatar: UserAvatarResolver
): Promise<PlatformNotificationData | null> {
  const accentColor = committedThemeAccent();
  const icon = getFaviconUrl(accentColor);
  const metadata = notification.notification_metadata;

  // A reminder is self-authored and points at its own detail resource. Do not
  // manufacture an actor/target sentence or resolve its id as a document.
  if (metadata.tag === 'reminder') {
    return {
      title: 'Reminder',
      options: {
        body: markdownToPlainText(metadata.content.description),
        icon,
      },
    };
  }

  const [actorName, avatarUrl] = await Promise.all([
    resolveActorName(notification, resolveUserName),
    resolveSenderAvatarUrl(notification, resolveUserAvatar),
  ]);
  const actor = actorName ?? USER_NAME_FALLBACK;

  const showTarget = shouldShowNotificationTarget(notification);
  const targetName =
    getNotificationTargetName(notification) ??
    (await resolveDocumentName(
      notification.entity_id,
      notification.entity_type
    )) ??
    DOCUMENT_NAME_FALLBACK;

  const content = getNotificationContent(notification);
  const action = getNotificationAction(notification);

  return {
    title: `${actor}${showTarget ? ` <${targetName}>` : ''}`,
    options: {
      body: content ? markdownToPlainText(content) : action,
      icon,
    },
    sender: actorName
      ? {
          id: notification.sender_id ?? actorName,
          name: actorName,
          avatarUrl,
        }
      : undefined,
    conversation: {
      id: notification.entity_id,
      name: showTarget ? targetName : undefined,
    },
  };
}

/**
 * Maybe handles a new notification as a platform notification.
 * If the notification is supported and formattable emit it and handle click events.
 */
export async function maybeHandlePlatformNotification(
  notification: UnifiedNotification,
  notificationInterface: PlatformNotificationState,
  splitLayoutManager: SplitManager
) {
  // Ignore notification types that should not show as browser notifications.
  // GitHub PR notifications should remain visible in-app, but should not
  // render as browser/system popups.
  if (
    notification.notification_metadata.tag === 'document_mention' ||
    (GITHUB_EVENT_TYPES as readonly string[]).includes(
      notification.notification_metadata.tag
    )
  ) {
    return;
  }

  const platformNotificationData = await toPlatformNotificationData(
    notification,
    DefaultUserNameResolver,
    DefaultDocumentNameResolver,
    DefaultUserAvatarResolver
  );

  if (platformNotificationData) {
    let notificationHandle = await notificationInterface.showNotification({
      ...platformNotificationData,
      notificationId: notification.id,
    });
    if (
      notificationHandle !== 'not-granted' &&
      notificationHandle !== 'disabled-in-ui'
    ) {
      notificationHandle.onClick(() => {
        window.focus();
        openNotification(notification, splitLayoutManager);
        notificationHandle.close();
      });
    }
  }
}
