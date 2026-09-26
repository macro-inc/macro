import type { SoupRow } from '@app/features/soup/collection/types';
import type { EntityData, Notification } from '@entity';
import { match } from 'ts-pattern';
import { getNotificationTag } from './utils';

/**
 * One channel can occupy several Inbox rows at once: the channel itself for
 * its unread messages, plus a `channel_thread` row per thread that mentioned
 * or replied to the viewer. Each row is separately actionable, which is why
 * they exist — but they all name the same channel and often preview the same
 * message, so the feed reads as duplicates.
 *
 * A stack keeps every row and its actions, and only changes how the run is
 * presented: the first row names the channel, the rest nest under it and say
 * what happened instead of repeating where.
 */
export type InboxChannelStack = {
  /** Position in the run; 0 is the row that names the channel. */
  index: number;
};

export const isStackFollower = (stack?: InboxChannelStack) =>
  stack !== undefined && stack.index > 0;

/** The channel a row stands for, or undefined when it isn't channel activity. */
function inboxChannelKey(entity: EntityData): string | undefined {
  if (entity.type === 'channel') return entity.id;
  if (entity.type === 'channel_message' || entity.type === 'channel_thread') {
    return entity.channelId;
  }
  return undefined;
}

/**
 * Brings a channel's rows together at the position of its newest one, leaving
 * every other row where the feed's own ordering put it. Rows have to be
 * adjacent before they can be presented as a stack, and the timestamps that
 * order them are close enough to interleave with unrelated rows.
 */
export function clusterInboxChannelEntities<T extends EntityData>(
  entities: T[]
): T[] {
  const byChannel = new Map<string, T[]>();
  for (const entity of entities) {
    const key = inboxChannelKey(entity);
    if (key === undefined) continue;
    const cluster = byChannel.get(key);
    if (cluster) cluster.push(entity);
    else byChannel.set(key, [entity]);
  }

  const emitted = new Set<string>();
  return entities.flatMap((entity) => {
    const key = inboxChannelKey(entity);
    if (key === undefined) return [entity];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return byChannel.get(key) ?? [entity];
  });
}

/**
 * Reads the stacks back off the built rows, by run of adjacent rows sharing a
 * channel. Group headers break a run, so a stack never spans a date bucket.
 * A lone row is not a stack and gets no entry.
 */
export function inboxChannelStacksByRowId(
  rows: readonly SoupRow<EntityData>[]
): Map<string, InboxChannelStack> {
  const stacks = new Map<string, InboxChannelStack>();
  let run: { key: string; rowIds: string[] } | undefined;

  const closeRun = () => {
    if (run && run.rowIds.length > 1) {
      run.rowIds.forEach((rowId, index) => stacks.set(rowId, { index }));
    }
    run = undefined;
  };

  for (const row of rows) {
    const key = row.kind === 'entity' ? inboxChannelKey(row.entity) : undefined;
    if (key === undefined) {
      closeRun();
      continue;
    }
    if (run?.key === key) run.rowIds.push(row.id);
    else {
      closeRun();
      run = { key, rowIds: [row.id] };
    }
  }
  closeRun();

  return stacks;
}

/**
 * What a nested row is, now that the row above it has already said where. Only
 * the kinds whose own title is the channel name need one; anything else keeps
 * what it would have shown on its own.
 *
 * `label` heads a row that names its sender elsewhere (the card's body line);
 * `action` completes "<sender> …" for the single-line rows that don't.
 */
export function inboxStackFollowerText(
  entity: EntityData,
  notification?: Notification
): { label: string; action: string } | undefined {
  if (entity.type === 'channel') {
    return { label: 'New messages', action: 'sent new messages' };
  }
  if (entity.type !== 'channel_thread' && entity.type !== 'channel_message') {
    return undefined;
  }
  return match(getNotificationTag(notification))
    .with('channel_mention', () => ({
      label: 'Mentioned you',
      action: 'mentioned you',
    }))
    .with('channel_message_reply', () => ({
      label: 'Replied in a thread',
      action: 'replied in a thread',
    }))
    .with('channel_message_send', () => ({
      label: 'New message',
      action: 'sent a message',
    }))
    .otherwise(() => undefined);
}
