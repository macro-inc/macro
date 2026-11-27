import { getFaviconUrl } from '@app/util/favicon';
import type { SplitManager } from '@components/app/split-layout/layoutManager';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import { committedThemeAccent } from '../theme/signals/themeSignals';
import { channelPlace } from './channel-place';
import type { PlatformNotificationState } from './components/PlatformNotificationProvider';
import { GITHUB_EVENT_TYPES } from './github-event-types';
import {
  getNotificationAction,
  getNotificationContent,
  getNotificationTargetName,
  pingedBy,
  reactionText,
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
import {
  getNotificationSenderAvatarUrl,
  UNKNOWN_SENDER_NAME,
} from './notification-sender';
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

/** As in the push: long enough to recognize, short enough that the
 * channel line under it stays on screen. */
const REACTION_EXCERPT_MAX_CHARS = 80;

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The message cut to whole characters, so a flag or skin tone never splits. */
function reactionExcerpt(messageContent: string) {
  const text = markdownToPlainText(messageContent)
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
  const graphemes = Array.from(GRAPHEMES.segment(text), (part) => part.segment);
  return graphemes.length > REACTION_EXCERPT_MAX_CHARS
    ? `${graphemes.slice(0, REACTION_EXCERPT_MAX_CHARS).join('')}…`
    : text;
}

/**
 * Who the notification reads as being from. Agent notifications and bot
 * messages have no user sender - a bot is not a user - so the bot (or, for a
 * mention, the author) named in the metadata stands in.
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
  if (meta.tag === 'routine_run_finished') {
    return meta.content.routineName;
  }
  if (meta.tag === 'computer_setup') {
    return meta.content.agent?.name ?? meta.content.computerName;
  }
  if (meta.tag === 'agent_sign_in_expiry') {
    return meta.content.computerName;
  }
  if (meta.tag === 'ping' && meta.content.agent) {
    return meta.content.agent.name;
  }
  if ('senderDisplayName' in meta.content && meta.content.senderDisplayName) {
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
  const actor = actorName ?? UNKNOWN_SENDER_NAME;
  const sender = actorName
    ? {
        id: notification.sender_id ?? actorName,
        name: actorName,
        avatarUrl,
      }
    : undefined;

  // A ping reads like its push: who pinged and what about, then their words.
  if (metadata.tag === 'ping') {
    const about = metadata.content.entityName ?? undefined;
    const deed = pingedBy(actorName);
    return {
      title: about ? `${deed} — ${about}` : deed,
      options: {
        body: markdownToPlainText(metadata.content.body),
        icon,
      },
      // macOS titles an alert with its sender and puts the conversation
      // beneath, so the sender says what they did.
      sender: sender && { ...sender, name: deed },
      conversation: { id: notification.entity_id, name: about },
    };
  }

  // A reaction reads like Slack's: who reacted, then "Reacted 👍 to: …" and
  // where. The channel stays out of the conversation, which macOS would put
  // above the reaction.
  if (metadata.tag === 'channel_message_reaction') {
    const reacted = reactionText({
      emoji: metadata.content.emoji,
      messageContent: reactionExcerpt(metadata.content.messageContent),
    });
    const place = channelPlace(metadata.content);
    return {
      title: actor,
      options: { body: place ? `${reacted}\n${place}` : reacted, icon },
      sender,
      conversation: { id: notification.entity_id, name: undefined },
    };
  }

  // An unresolved target is left out of the title, not shown as a placeholder.
  const targetName =
    getNotificationTargetName(notification) ??
    (await resolveDocumentName(
      notification.entity_id,
      notification.entity_type
    ));
  const showTarget =
    shouldShowNotificationTarget(notification) && targetName !== undefined;

  const content = getNotificationContent(notification);
  const action = getNotificationAction(notification);

  return {
    title: `${actor}${showTarget ? ` <${targetName}>` : ''}`,
    options: {
      body: content ? markdownToPlainText(content) : action,
      icon,
    },
    sender,
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
  splitLayoutManager: SplitManager,
  delivery: { silent?: boolean } = {}
) {
  // Ignore notification types that should not show as browser notifications.
  // GitHub PR and routine run notifications should remain visible in-app, but
  // should not render as browser/system popups.
  if (
    notification.notification_metadata.tag === 'document_mention' ||
    notification.notification_metadata.tag === 'routine_run_finished' ||
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
      options: { ...platformNotificationData.options, silent: delivery.silent },
      notificationId: notification.id,
    });
    if (
      notificationHandle !== 'not-granted' &&
      notificationHandle !== 'disabled-in-ui'
    ) {
      notificationHandle.onClick(() => {
        window.focus();
        openNotification(
          notification,
          splitLayoutManager,
          false,
          undefined,
          undefined,
          { source: 'browser_push' }
        );
        notificationHandle.close();
      });
    }
  }
}
