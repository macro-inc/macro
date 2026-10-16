import { timelineEntryKey } from '@queries/messages/timeline-entries';
import type { ChannelMessageListMeta } from '../Message/list-meta';
import {
  type GroupableMessage,
  shouldGroupWithPreviousMessage,
} from './message-grouping-meta';

/** One timeline row: a message, or system activity between messages. */
type ChannelListEntry<T> =
  | { type: 'message'; message: T }
  | { type: 'activity'; activity: { id: string; occurred_at: string } };

/** List meta keyed by `timelineEntryKey`, oldest entry first. */
export function buildChannelMessageListMeta<T extends GroupableMessage>(
  entries: ChannelListEntry<T>[],
  isNewMessageFn: (message: T) => boolean,
  reachedStart: boolean,
  /**
   * A thread is visually open for this message even without replies (e.g. a
   * reply is being composed), so the rail must reach it.
   */
  isThreadOpen?: (message: T) => boolean
): Record<string, ChannelMessageListMeta> {
  const metaByKey: Record<string, ChannelMessageListMeta> = {};
  let previousTopLevelCreatedAt: string | undefined;
  let previousMessage: T | undefined;
  let foundFirstNewMessage = false;

  for (const [index, entry] of entries.entries()) {
    const key = timelineEntryKey(entry);
    if (entry.type === 'activity') {
      metaByKey[key] = {
        index,
        isNewMessage: false,
        isFirstNewMessage: false,
        previousTopLevelCreatedAt,
        isGroupedWithPrevious: false,
        reachedStart,
      };
      previousTopLevelCreatedAt = entry.activity.occurred_at;
      // Activity ends the sender run, so neither grouping nor rails cross it.
      previousMessage = undefined;
      continue;
    }

    const message = entry.message;
    const isNewMessage = isNewMessageFn(message);
    const isFirstNewMessage = isNewMessage && !foundFirstNewMessage;

    if (isFirstNewMessage) {
      foundFirstNewMessage = true;
    }

    metaByKey[key] = {
      index,
      isNewMessage,
      isFirstNewMessage,
      previousTopLevelCreatedAt,
      isGroupedWithPrevious: shouldGroupWithPreviousMessage(
        message,
        previousMessage
      ),
      reachedStart,
    };

    previousTopLevelCreatedAt = message.created_at;
    previousMessage = message;
  }

  // Backward pass: a row carries the rail through it when a later member of
  // its sender run owns a thread (the rail runs from the run's header avatar
  // down to that fork point). A grouped row always follows a message.
  for (let i = entries.length - 2; i >= 0; i--) {
    const next = entries[i + 1]!;
    if (next.type !== 'message') continue;
    const nextMeta = metaByKey[next.message.id]!;
    if (!nextMeta.isGroupedWithPrevious) continue;
    metaByKey[timelineEntryKey(entries[i]!)]!.threadRailBelow =
      (next.message.thread?.reply_count ?? 0) > 0 ||
      isThreadOpen?.(next.message) === true ||
      nextMeta.threadRailBelow === true;
  }

  return metaByKey;
}
