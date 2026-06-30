import { MACRO_AI_BOT_ID, MACRO_AI_NAME } from '@channel/macroAi';
import { macroIdToEmail, tryMacroId } from '@core/user';
import { type EntityData, isTaskEntity, type Notification } from '@entity';
import {
  getSortedKeyProperties,
  soupPropertyToProperty,
} from '@entity/extractors-property/property-helpers';
import { senderFromStorageId } from '@queries/channel/message-sender';
import type { SoupProperty } from '@service-storage/generated/schemas/soupProperty';
import {
  differenceInDays,
  differenceInHours,
  differenceInMilliseconds,
  differenceInMonths,
  differenceInWeeks,
  differenceInYears,
  format,
} from 'date-fns';
import { match, P } from 'ts-pattern';

function notificationContent(notification: Notification): string | undefined {
  const content = notification.notification_metadata.content as
    | {
        messageContent?: string;
        text?: string;
        snippet?: string;
        summary?: string;
        commentSnippet?: string;
        textSnippet?: string;
        reviewSnippet?: string;
      }
    | undefined;
  switch (notification.notification_metadata.tag) {
    case 'channel_mention':
    case 'channel_message_send':
    case 'channel_message_reply':
      return content?.messageContent;
    case 'mentioned_in_document_comment':
    case 'replied_to_document_comment_thread':
    case 'commented_on_document':
      return content?.text;
    case 'new_email':
      return content?.snippet || undefined;
    case 'ai_response':
      return content?.summary;
    case 'github_pr_comment':
      return content?.commentSnippet;
    case 'github_pr_mention':
      return content?.textSnippet;
    case 'github_pr_review':
      return content?.reviewSnippet;
    default:
      return undefined;
  }
}

/** Sender display name carried by a notification, by tag. */
function notificationSenderName(
  notification: Notification
): string | undefined {
  const content = notification.notification_metadata.content as
    | { sender?: string; senderGithubLogin?: string }
    | undefined;
  switch (notification.notification_metadata.tag) {
    case 'new_email':
      return content?.sender ?? undefined;
    case 'ai_response':
      return 'Macro agent';
    case 'channel_message_send':
      return content?.sender ?? notification.sender_id ?? undefined;
    case 'github_pr_status_changed':
    case 'github_review_requested':
    case 'github_pr_comment':
    case 'github_pr_mention':
    case 'github_pr_review':
      return content?.senderGithubLogin ?? notification.sender_id ?? undefined;
    default:
      return undefined;
  }
}

export function getNotificationTag(notification?: Notification) {
  return notification?.notification_metadata.tag;
}

const channelTypeOf = (entity: EntityData): string | undefined =>
  entity.type === 'channel' ||
  entity.type === 'channel_message' ||
  entity.type === 'channel_thread'
    ? entity.channelType
    : undefined;

const channelMessageContent = (entity: EntityData): string | undefined => {
  if (entity.type === 'channel') return entity.latestRootMessage?.content;
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.content;
  }
  return undefined;
};

export function itemContent(
  entity: EntityData,
  notification?: Notification
): string | undefined {
  const channel = channelMessageContent(entity);
  if (channel) return channel;
  return notification ? notificationContent(notification) : undefined;
}

// ---------------------------------------------------------------------------
// Sender helpers
// ---------------------------------------------------------------------------

/** The sender's macro id / raw id, derived from the entity or notification. */
export function senderIdOf(
  entity: EntityData,
  notification?: Notification
): string | undefined {
  if (entity.type === 'channel') {
    return entity.latestRootMessage?.senderId;
  }
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.senderId;
  }

  return notification?.sender_id ?? undefined;
}

/** A pre-formatted sender name (email-style senders), when not id-resolvable. */
export function senderNameRaw(
  entity: EntityData,
  notification?: Notification
): string | undefined {
  if (
    entity.type === 'channel' ||
    entity.type === 'channel_message' ||
    entity.type === 'channel_thread'
  ) {
    return undefined; // resolved from the sender id instead
  }
  // Emails carry their own sender on the entity; prefer it over the
  // notification so we don't fall back to "?" when notification data is thin.
  if (entity.type === 'email') {
    return (
      entity.senderName ??
      (notification ? notificationSenderName(notification) : undefined) ??
      entity.senderEmail
    );
  }
  return notification ? notificationSenderName(notification) : undefined;
}

export function parseSenderName(
  entity: EntityData,
  notification?: Notification
): string {
  const name =
    senderNameRaw(entity, notification) ||
    senderIdOf(entity, notification) ||
    '?';
  const emailMatch = name.match(/^"?([^"<]+)"?\s*</);
  if (emailMatch?.[1]) return emailMatch[1].trim();
  const parsedMacroId = tryMacroId(name);
  if (parsedMacroId) return macroIdToEmail(parsedMacroId);
  return name;
}

/** Best synchronous display name (the layout upgrades it reactively by id). */
export function senderDisplayName(
  entity: EntityData,
  notification?: Notification
): string {
  const senderId = senderIdOf(entity, notification);

  if (senderId) {
    const parsed = senderFromStorageId(senderId);

    if (parsed.type === 'bot') {
      return (
        parsed.name ?? (parsed.id === MACRO_AI_BOT_ID ? MACRO_AI_NAME : 'Bot')
      );
    }

    const macroId = tryMacroId(senderId);
    if (macroId) return macroIdToEmail(macroId);
  }

  return parseSenderName(entity, notification);
}

export function getGithubLocationLabel(
  entity: EntityData,
  notification?: Notification
) {
  if (
    entity.type === 'foreign' &&
    entity.foreignSource === 'github_pull_request'
  ) {
    const { owner, repo, number } = entity.metadata;
    return `${owner}/${repo}#${number}`;
  }
  const content = notification?.notification_metadata.content as
    | { owner?: string; repo?: string; number?: number }
    | undefined;
  if (!content?.owner || !content.repo || content.number == null) {
    return undefined;
  }
  return `${content.owner}/${content.repo}#${content.number}`;
}

export function getGithubTitle(
  entity: EntityData,
  notification?: Notification
) {
  if (
    entity.type === 'foreign' &&
    entity.foreignSource === 'github_pull_request'
  ) {
    return entity.metadata.name;
  }
  const content = notification?.notification_metadata.content as
    | { title?: string }
    | undefined;

  return content?.title;
}

const githubActionText = (
  metadata?: Notification['notification_metadata']
): string => {
  if (metadata?.tag === 'github_pr_status_changed') {
    if (metadata.content.status === 'merged') return 'merged a PR';
  }
  return 'updated';
};

// ---------------------------------------------------------------------------
// Rendered text
// ---------------------------------------------------------------------------

const hashChannel = (
  entity: EntityData,
  value: string | undefined
): string | undefined => {
  if (!value) return undefined;
  const type = entity.type;
  if (
    type === 'channel' ||
    type === 'channel_message' ||
    type === 'channel_thread'
  ) {
    return value.startsWith('#') ? value : `#${value}`;
  }
  return value;
};

export interface InboxItemText {
  /** Verb shown in the action row, e.g. "replied in". */
  action: string;
  /** Where it happened, display-ready (channels prefixed with #). */
  location?: string;
  /** Message / preview body. */
  content?: string;
}

/**
 * Single source for an item's rendered text: one `match` over the notification
 * tag yields the action verb, location, and content together.
 */
export function getInboxItemText(
  entity: EntityData,
  notification?: Notification,
  opts: { nested?: boolean; groupRoot?: boolean } = {}
): InboxItemText {
  const nested = opts.nested ?? false;
  const name = entity.name;
  const content = itemContent(entity, notification);
  const dm = channelTypeOf(entity) === 'direct_message';

  const channelLocation = nested || dm ? undefined : hashChannel(entity, name);
  const githubLocation = nested
    ? undefined
    : (getGithubLocationLabel(entity, notification) ?? name);
  const entityLocation = nested || dm ? undefined : name;

  const metadata = notification?.notification_metadata;
  // if (entity.type === 'channel_thread') {
  //   console.log(metadata);
  // }

  const text = match(metadata)
    .with({ tag: 'channel_mention' }, () => ({
      action: nested ? 'mentioned you' : 'mentioned you in',
      location: channelLocation,
      content,
    }))
    .with({ tag: 'channel_message_reply' }, () => ({
      action: 'replied',
      location: channelLocation,
      content,
    }))
    .with({ tag: 'channel_message_send' }, () => ({
      action: 'sent a message',
      location: channelLocation,
      content,
    }))
    .with({ tag: 'document_mention' }, (m) => ({
      action: 'shared',
      location: entityLocation,
      content: m.content.messageContent,
    }))
    .with({ tag: 'mentioned_in_document_comment' }, () => ({
      action: nested ? 'mentioned you' : 'mentioned you in',
      location: entityLocation,
      content,
    }))
    .with({ tag: 'replied_to_document_comment_thread' }, () => ({
      action: nested ? 'replied' : 'replied in',
      location: entityLocation,
      content,
    }))
    .with({ tag: 'new_email' }, (m) => ({
      action: 'sent an email',
      location: undefined,
      content: m.content.subject || name || content,
    }))
    .with(
      P.union(
        P.when(() => isTaskEntity(entity)),
        { tag: 'task_assigned' }
      ),
      () => ({
        action: 'assigned you a task',
        location: undefined,
        content: content,
      })
    )
    .with({ tag: 'ai_response' }, () => ({
      action: 'responded in',
      location: entityLocation,
      content,
    }))
    .when(
      () => entity.type === 'chat',
      () => ({
        action: '',
        location: entityLocation,
        content,
      })
    )
    .with(
      { tag: 'github_pr_status_changed' },
      { tag: 'github_review_requested' },
      { tag: 'github_pr_comment' },
      { tag: 'github_pr_mention' },
      { tag: 'github_pr_review' },
      (m) => ({
        action: githubActionText(m),
        location: githubLocation,
        content: m.content.title || name || content,
      })
    )
    .otherwise((m) => {
      console.log('Missed', m);
      return {
        action: 'updated',
        location: entityLocation,
        content,
      };
    });

  return opts.groupRoot ? { ...text, content: content || name } : text;
}

export function getEmailSubject(notification?: Notification) {
  const content = notification?.notification_metadata.content as
    | { subject?: string }
    | undefined;
  return content?.subject;
}

/** Key task properties (pills), derived from the document entity. */
export function getInboxTaskProperties(entity: EntityData) {
  if (entity.type !== 'document') return undefined;
  if (!('properties' in entity) || !entity.properties?.length) return undefined;

  const keyProperties = getSortedKeyProperties(
    entity.properties.map((property: SoupProperty) =>
      soupPropertyToProperty(property)
    )
  );
  return keyProperties.length ? keyProperties : undefined;
}

export function formatCompactRelativeTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const ageMs = differenceInMilliseconds(now, date);
  if (ageMs < 12 * 60 * 60 * 1000) return format(date, 'p');

  const hours = differenceInHours(now, date);
  if (hours < 24) return `${Math.max(12, hours)}h`;

  const days = differenceInDays(now, date);
  if (days < 7) return `${Math.max(1, days)}d`;

  const weeks = differenceInWeeks(now, date);
  if (weeks < 5) return `${Math.max(1, weeks)}w`;

  const months = differenceInMonths(now, date);
  if (months < 12) return `${Math.max(1, months)}mo`;

  return `${Math.max(1, differenceInYears(now, date))}y`;
}

export function getFirstName(value: string) {
  const name = value.includes('@') ? value.split('@')[0] : value;
  return name.split(/[\s._-]+/).filter(Boolean)[0] ?? name;
}

export interface InboxText {
  title: string;
  content?: string;
}

function buildActionLabel(args: {
  sender?: string;
  action: string;
  location?: string;
}): string {
  return [args.sender, args.action, args.location].filter(Boolean).join(' ');
}

function getChannelName(entity: EntityData): string | undefined {
  if (entity.type === 'channel') return entity.name;
  if (entity.type === 'channel_message') return entity.name;
  if (entity.type === 'channel_thread') return entity.name;
  return undefined;
}

function getChannelLocation(
  entity: EntityData,
  opts: { nested?: boolean }
): string | undefined {
  if (opts.nested) return undefined;
  if (
    entity.type !== 'channel' &&
    entity.type !== 'channel_message' &&
    entity.type !== 'channel_thread'
  ) {
    return undefined;
  }
  if (entity.channelType === 'direct_message') return undefined;

  const name = getChannelName(entity);
  if (!name) return undefined;
  return name.startsWith('#') ? name : `#${name}`;
}

function getLocation(
  entity: EntityData,
  opts: { nested?: boolean }
): string | undefined {
  if (opts.nested) return undefined;
  if (
    (entity.type === 'channel' ||
      entity.type === 'channel_message' ||
      entity.type === 'channel_thread') &&
    entity.channelType === 'direct_message'
  ) {
    return undefined;
  }
  return entity.name;
}

function getGithubLocation(
  entity: EntityData,
  notification?: Notification,
  opts: { nested?: boolean } = {}
): string | undefined {
  if (opts.nested) return undefined;
  return getGithubLocationLabel(entity, notification) ?? entity.name;
}

function getChannelRootSenderName(
  entity: EntityData,
  fallback: string
): string {
  if (entity.type !== 'channel') return fallback;

  const senderId = entity.latestRootMessage?.senderId;
  if (!senderId) return fallback;

  const macroId = tryMacroId(senderId);
  if (macroId) return macroIdToEmail(macroId);

  return senderId;
}

function getGithubAction(
  metadata: Notification['notification_metadata']
): string {
  return match(metadata)
    .with(
      { tag: 'github_pr_status_changed', content: { status: 'merged' } },
      () => 'merged'
    )
    .with(
      { tag: 'github_pr_status_changed', content: { status: 'closed' } },
      () => 'closed'
    )
    .with({ tag: 'github_review_requested' }, () => 'requested your review on')
    .with({ tag: 'github_pr_comment' }, () => 'commented on')
    .with({ tag: 'github_pr_mention' }, () => 'mentioned you in')
    .with({ tag: 'github_pr_review' }, () => 'reviewed')
    .otherwise(() => 'updated');
}

export function getInboxText(
  entity: EntityData,
  notification?: Notification,
  opts: { nested?: boolean; groupRoot?: boolean } = {}
): InboxText {
  const metadata = notification?.notification_metadata;
  const sender = senderDisplayName(entity, notification);
  const name = entity.name;
  const content = itemContent(entity, notification);
  const channelLocation = getChannelLocation(entity, opts);
  const entityLocation = getLocation(entity, opts);
  const githubLocation = getGithubLocation(entity, notification, opts);

  const text = match({ entity, metadata })
    .with({ metadata: { tag: 'channel_mention' } }, () => ({
      title: buildActionLabel({
        sender,
        action: channelLocation ? 'mentioned you in' : 'mentioned you',
        location: channelLocation,
      }),
      content,
    }))
    .with({ metadata: { tag: 'channel_message_reply' } }, () => ({
      title: buildActionLabel({
        sender,
        action: channelLocation ? 'replied in' : 'replied',
        location: channelLocation,
      }),
      content,
    }))
    .with({ metadata: { tag: 'channel_message_send' } }, () => ({
      title: buildActionLabel({
        sender,
        action: channelLocation ? 'sent a message in' : 'sent a message',
        location: channelLocation,
      }),
      content,
    }))
    .with({ entity: { type: 'channel' } }, ({ entity }) => ({
      title: buildActionLabel({
        sender: getChannelRootSenderName(entity, sender),
        action: channelLocation ? 'sent a message in' : 'sent a message',
        location: channelLocation,
      }),
      content: entity.latestRootMessage?.content ?? content,
    }))
    .with({ entity: { type: 'channel_message' } }, () => ({
      title: buildActionLabel({
        sender,
        action: channelLocation ? 'sent a message in' : 'sent a message',
        location: channelLocation,
      }),
      content,
    }))
    .with({ entity: { type: 'channel_thread' } }, () => ({
      title: buildActionLabel({
        sender,
        action: channelLocation ? 'started a thread in' : 'started a thread',
        location: channelLocation,
      }),
      content,
    }))
    .with({ metadata: { tag: 'document_mention' } }, ({ metadata }) => ({
      title: buildActionLabel({
        sender,
        action: 'shared',
        location: entityLocation,
      }),
      content: metadata.content.messageContent,
    }))
    .with({ metadata: { tag: 'mentioned_in_document_comment' } }, () => ({
      title: buildActionLabel({
        sender,
        action: entityLocation ? 'mentioned you in' : 'mentioned you',
        location: entityLocation,
      }),
      content,
    }))
    .with({ metadata: { tag: 'replied_to_document_comment_thread' } }, () => ({
      title: buildActionLabel({
        sender,
        action: entityLocation ? 'replied in' : 'replied',
        location: entityLocation,
      }),
      content,
    }))
    .with({ metadata: { tag: 'task_assigned' } }, () => ({
      title: buildActionLabel({ sender, action: 'assigned you a task' }),
      content: content || name,
    }))
    .with(
      { entity: P.when((value) => isTaskEntity(value)), metadata: undefined },
      () => ({
        title: name,
        content,
      })
    )
    .with({ entity: { type: 'document' } }, () => ({
      title: name,
      content,
    }))
    .with({ metadata: { tag: 'new_email' } }, ({ metadata }) => ({
      title: buildActionLabel({ sender, action: 'sent an email' }),
      content: metadata.content.subject || name || content,
    }))
    .with({ entity: { type: 'email' } }, ({ entity }) => ({
      title: buildActionLabel({ sender, action: 'sent an email' }),
      content: entity.snippet || name || content,
    }))
    .with({ entity: { type: 'chat' }, metadata: undefined }, () => ({
      title: name,
      content,
    }))
    .with({ metadata: { tag: 'ai_response' } }, () => ({
      title: buildActionLabel({
        sender: 'Macro',
        action: entityLocation ? 'responded in' : 'responded',
        location: entityLocation,
      }),
      content,
    }))
    .with(
      { metadata: { tag: 'github_pr_status_changed' } },
      { metadata: { tag: 'github_review_requested' } },
      { metadata: { tag: 'github_pr_comment' } },
      { metadata: { tag: 'github_pr_mention' } },
      { metadata: { tag: 'github_pr_review' } },
      ({ metadata }) => ({
        title: buildActionLabel({
          sender,
          action: getGithubAction(metadata),
          location: githubLocation,
        }),
        content: getGithubTitle(entity, notification) || name || content,
      })
    )
    .with(
      { entity: { type: 'foreign', foreignSource: 'github_pull_request' } },
      ({ entity }) => ({
        title: buildActionLabel({
          sender: entity.metadata.authorLogin,
          action: 'opened',
          location: `${entity.metadata.owner}/${entity.metadata.repo}#${entity.metadata.number}`,
        }),
        content: entity.metadata.name,
      })
    )
    .with({ metadata: { tag: 'call_started' } }, () => ({
      title: buildActionLabel({
        sender,
        action: entityLocation ? 'started a call in' : 'started a call',
        location: entityLocation,
      }),
      content,
    }))
    .with({ entity: { type: 'call', status: 'MISSED' } }, () => ({
      title: name ? `Missed call in #${name}` : 'Missed call',
      content,
    }))
    .with({ entity: { type: 'call', status: 'UNATTENDED' } }, () => ({
      title: name ? `Call unattended in #${name}` : 'Call unattended',
      content,
    }))
    .with({ entity: { type: 'call' } }, () => ({
      title: name ? `Call in #${name}` : 'Call',
      content,
    }))
    .otherwise(() => ({
      title: name ? `${name} updated` : 'Updated',
      content,
    }));

  if (!opts.groupRoot) return text;
  return { ...text, content: text.content || name };
}
