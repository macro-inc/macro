import type { EntityData } from '@entity';
import { getChannelNotificationParams } from '@notifications/notification-navigation';
import type { UnifiedNotification } from '@notifications/types';
import { attentionFeedSoupItem } from '@queries/attention-feed/attention-feed-entity';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import type {
  NotificationInboxEntryFieldsFragment,
  NotificationInboxRowType,
  NotificationInboxScopeInput,
} from '@service-storage/graphql/generated/graphql';
import { mapGraphqlNotification } from '@service-storage/graphql-soup';
import { match } from 'ts-pattern';
import type {
  InboxRowContent,
  InboxScope,
  NotificationInboxRow,
} from '../context/notifications-inbox-context';
import { ALL_INBOX_ROW_TYPES } from '../core/inbox-filters';
import type {
  InboxActor,
  InboxRowAction,
  InboxRowType,
} from '../core/inbox-row';
import type { NotificationInboxGroup } from './notification-inbox-groups';

type WireRow = NotificationInboxEntryFieldsFragment['rows'][number];

/** The server's row types only grow; a newer one shows as a generic row. */
const toRowType = (
  type: NotificationInboxRowType
): NotificationInboxRow['type'] =>
  match<NotificationInboxRowType, NotificationInboxRow['type']>(type)
    .with('AGENT', () => 'agent' as const)
    .with('EMAIL', () => 'email' as const)
    .with('CHANNEL_MENTION', () => 'channel_mention' as const)
    .with('CHANNEL_MESSAGES', () => 'channel_messages' as const)
    .with('CHANNEL_THREAD', () => 'channel_thread' as const)
    .with('DISCUSSION_MENTION', () => 'discussion_mention' as const)
    .with('DISCUSSION_MESSAGES', () => 'discussion_messages' as const)
    .with('DISCUSSION_THREAD', () => 'discussion_thread' as const)
    .with('TASK', () => 'task' as const)
    .with('PULL_REQUEST', () => 'pull_request' as const)
    .with('CALENDAR_EVENT', () => 'calendar_event' as const)
    .with('CALENDAR_JOIN_REQUEST', () => 'calendar_join_request' as const)
    .with('ACCESS_REQUESTED', () => 'access_requested' as const)
    .with('ACCESS_GRANTED', () => 'access_granted' as const)
    .exhaustive(() => 'other' as const);

/** An actor kind this build doesn't know names no author. */
const toActor = (actor: WireRow['actor']): InboxActor | undefined => {
  if (!actor) return undefined;
  return match(actor.kind)
    .returnType<InboxActor>()
    .with('USER', () =>
      actor.principalId
        ? { kind: 'user', id: actor.principalId }
        : { kind: 'other' }
    )
    .with('AGENT', () => ({ kind: 'agent', name: actor.name ?? undefined }))
    .with('MACRO', () => ({ kind: 'macro' }))
    .exhaustive(() => ({ kind: 'other' }));
};

/**
 * The actions this build can offer. An unknown kind, or one missing the
 * target or url it acts on, is skipped.
 */
const toActions = (actions: WireRow['actions']): InboxRowAction[] =>
  actions.flatMap(({ kind, targetId, url }) =>
    match(kind)
      .returnType<InboxRowAction[]>()
      .with('OPEN', () => [{ kind: 'open' }])
      .with('ANSWER', () => [{ kind: 'answer' }])
      .with('REVIEW', () => (url ? [{ kind: 'review', url }] : []))
      .with('APPROVE', () => (targetId ? [{ kind: 'approve', targetId }] : []))
      .with('DENY', () => (targetId ? [{ kind: 'deny', targetId }] : []))
      .with('ACCEPT', () => (targetId ? [{ kind: 'accept', targetId }] : []))
      .with('DECLINE', () => (targetId ? [{ kind: 'decline', targetId }] : []))
      .exhaustive(() => [])
  );

const toGraphqlRowType = (type: InboxRowType): NotificationInboxRowType =>
  match(type)
    .with('agent', () => 'AGENT' as const)
    .with('email', () => 'EMAIL' as const)
    .with('channel_mention', () => 'CHANNEL_MENTION' as const)
    .with('channel_messages', () => 'CHANNEL_MESSAGES' as const)
    .with('channel_thread', () => 'CHANNEL_THREAD' as const)
    .with('discussion_mention', () => 'DISCUSSION_MENTION' as const)
    .with('discussion_messages', () => 'DISCUSSION_MESSAGES' as const)
    .with('discussion_thread', () => 'DISCUSSION_THREAD' as const)
    .with('task', () => 'TASK' as const)
    .with('pull_request', () => 'PULL_REQUEST' as const)
    .with('calendar_event', () => 'CALENDAR_EVENT' as const)
    .with('calendar_join_request', () => 'CALENDAR_JOIN_REQUEST' as const)
    .with('access_requested', () => 'ACCESS_REQUESTED' as const)
    .with('access_granted', () => 'ACCESS_GRANTED' as const)
    .exhaustive(() => {
      throw new Error(`Unknown inbox row type: ${type}`);
    });

/**
 * Encode an inbox scope for the server. Every known type reads every row,
 * including row types a newer server adds.
 */
export function encodeInboxScope(
  scope: InboxScope
): NotificationInboxScopeInput {
  const everyType = ALL_INBOX_ROW_TYPES.every((type) =>
    scope.rowTypes.includes(type)
  );
  return { rowTypes: everyType ? [] : scope.rowTypes.map(toGraphqlRowType) };
}

/**
 * The entity one row opens: it carries only the row's notifications, and a
 * channel row names the message its newest notification is about, since a
 * thread row's channel entity would otherwise open at the channel's latest.
 */
function rowEntity(
  entity: EntityData,
  notifications: UnifiedNotification[]
): InboxRowContent['entity'] {
  const read = () => notifications;
  const [newest] = notifications;
  if (!newest || entity.type !== 'channel') {
    return { ...entity, notifications: read };
  }
  const { messageId, threadId } = getChannelNotificationParams(newest);
  return messageId
    ? { ...entity, notifications: read, target: { messageId, threadId } }
    : { ...entity, notifications: read };
}

/** Rows decoded by an earlier read, with the wire data each came from. */
export type InboxRowMemo = {
  previous: ReadonlyMap<string, { wire: string; row: NotificationInboxRow }>;
  next: Map<string, { wire: string; row: NotificationInboxRow }>;
};

/**
 * Project one inbox entry into rows. Each row's entity carries only that
 * row's notifications, so entity-based helpers (icons, preview targets) see
 * what the row shows. An entity the app does not list, or an entry without a
 * valid place, is dropped. With a memo, a row that did not change keeps its
 * object.
 */
export function toInboxGroup(
  entry: NotificationInboxEntryFieldsFragment,
  memo?: InboxRowMemo
): NotificationInboxGroup | null {
  const sortAt = Date.parse(entry.sortAt);
  const soupItem = attentionFeedSoupItem(entry.entity);
  if (!soupItem || Number.isNaN(sortAt)) return null;
  const entity = mapApiSoupItemToEntity(soupItem);
  const entityWire = memo ? JSON.stringify(entry.entity) : '';
  return {
    groupId: entry.groupId,
    sortAt,
    rows: entry.rows.flatMap((row) => {
      const latestAt = Date.parse(row.latestAt);
      if (Number.isNaN(latestAt)) return [];
      const wire = memo ? `${entityWire}${JSON.stringify(row)}` : '';
      const known = memo?.previous.get(row.id);
      if (memo && known?.wire === wire) {
        memo.next.set(row.id, known);
        return [known.row];
      }
      const notifications = row.notifications.map(mapGraphqlNotification);
      const decoded: NotificationInboxRow = {
        id: row.id,
        type: toRowType(row.rowType),
        threadId: row.threadId ?? undefined,
        revision: row.revision,
        latestAt,
        actor: toActor(row.actor),
        actions: toActions(row.actions),
        unseen: row.unseen,
        count: row.count,
        content: { entity: rowEntity(entity, notifications), notifications },
      };
      memo?.next.set(row.id, { wire, row: decoded });
      return [decoded];
    }),
  };
}
