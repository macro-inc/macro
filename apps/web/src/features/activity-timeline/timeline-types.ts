import type { EntityData } from '@entity';
import type { UnifiedNotification } from '@notifications';

/**
 * The action a soup-derived timeline row stands for. Notification-derived
 * rows carry their own event type in the notification metadata instead.
 */
export type EntityEventVerb =
  | 'sent-message'
  | 'replied-in-thread'
  | 'sent-email'
  | 'drafted-email'
  | 'email-activity'
  | 'created-document'
  | 'edited-document'
  | 'created-task'
  | 'created-folder'
  | 'agent-chat'
  | 'attended-call';

/**
 * One row of an activity timeline: either a notification (someone did
 * something — the metadata carries actor, action, and content) or an
 * entity-derived event (an action inferred from a soup row, e.g. "you sent
 * this message"). `ts` is epoch milliseconds and must match the ordering of
 * the feed that produced the item, since the merge relies on it.
 */
export type TimelineItem =
  | {
      kind: 'notification';
      id: string;
      ts: number;
      notification: UnifiedNotification;
    }
  | {
      kind: 'entity-event';
      id: string;
      ts: number;
      verb: EntityEventVerb;
      entity: EntityData;
    };

/**
 * A paginated, newest-first stream of timeline items. Thin adapter over an
 * infinite query so heterogeneous sources (notifications, soup) can be
 * merged into one timeline.
 */
export type TimelineFeed = {
  /** Items loaded so far, sorted newest-first. */
  items: () => TimelineItem[];
  /** Whether more (older) pages exist. */
  hasMore: () => boolean;
  /** Whether the first page is still loading. */
  isLoading: () => boolean;
  /** Whether an older page is currently being fetched. */
  isFetchingMore: () => boolean;
  /** Request the next (older) page. No-op while already fetching. */
  fetchMore: () => void;
};
