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
  | 'edited-task'
  | 'created-folder'
  | 'agent-chat'
  | 'attended-call';

/**
 * One row of an activity timeline: either a notification (someone did
 * something — the metadata carries actor, action, and content) or an
 * entity-derived event (an action inferred from a soup row, e.g. "you sent
 * this message"). `ts` is epoch milliseconds.
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

export type NotificationTimelineItem = Extract<
  TimelineItem,
  { kind: 'notification' }
>;
export type EntityTimelineItem = Extract<
  TimelineItem,
  { kind: 'entity-event' }
>;

/**
 * A paginated stream of timeline items. Thin adapter over an infinite query
 * so heterogeneous sources (notifications, soup) can be merged into one
 * timeline.
 *
 * `boundaryTs` is the pagination cursor position expressed as a timestamp:
 * every server row with sort-ts newer than it has been fetched. Items may be
 * synthesized at timestamps older than the row they came from (e.g. a
 * document row also emits a "created" event at its creation time), so the
 * merge trusts `boundaryTs`, not item order, for completeness.
 */
export type TimelineFeed = {
  /** Items loaded so far, in any order. */
  items: () => TimelineItem[];
  /**
   * Completeness boundary: all server rows newer than this are loaded.
   * `undefined` while nothing has been fetched yet.
   */
  boundaryTs: () => number | undefined;
  /** Whether more (older) pages exist. */
  hasMore: () => boolean;
  /** Whether the first page is still loading. */
  isLoading: () => boolean;
  /** Whether an older page is currently being fetched. */
  isFetchingMore: () => boolean;
  /** Request the next (older) page. No-op while already fetching. */
  fetchMore: () => void;
};
