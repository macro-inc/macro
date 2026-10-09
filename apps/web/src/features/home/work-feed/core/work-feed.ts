import type { EntityWithRawNotifications } from '@app/features/soup/entity-notifications';
import type { DateValue } from '@core/util/date';
import type { EntityData } from '@entity';

/** Which reasons admit items to a work feed. */
export type WorkFeedMode = 'work' | 'attention';

/** Item kinds a work feed can be narrowed to. */
export type WorkFeedItemType =
  | 'document'
  | 'chat'
  | 'project'
  | 'email'
  | 'channel'
  | 'channel_thread'
  | 'calendar_event'
  | 'pull_request'
  | 'agent_session';

/** Which items one feed shows. Pages, live updates and undo share it. */
export type WorkFeedScope = {
  mode: WorkFeedMode;
  /** Empty means every kind. */
  types: WorkFeedItemType[];
  includeSnippets: boolean;
};

export type WorkFeedItemState = 'unseen' | 'seen' | 'done';

/** One item placed in a feed, decoded into the app's entity vocabulary. */
export type WorkFeedEntry = {
  /** Stable per-viewer item id: `<entity type>:<entity id>`. */
  itemId: string;
  /** Opaque token of the reasons this entry shows; done acknowledges it. */
  revision: string;
  /** Feed placement, epoch milliseconds. */
  sortAt: number;
  state: WorkFeedItemState;
  primaryReason: 'own_work' | 'attention';
  /** The item has outstanding notifications, which done acknowledges. */
  hasAttention: boolean;
  /** The viewer worked on the item; done leaves that reason in place. */
  hasOwnWork: boolean;
  /**
   * The row entity with the item's scoped notifications attached raw, so
   * readers apply local seen/done overrides the way Home rows always have.
   */
  entity: EntityWithRawNotifications<EntityData> & {
    notificationDisplayCutoff?: DateValue | null;
  };
};

/**
 * Items the viewer marked done, with the revision they acknowledged. They
 * stay hidden while a loaded entry still shows that revision, until the
 * live change that removes them lands; a newer reason shows them again.
 */
export type WorkFeedDone = ReadonlyMap<string, string>;

/** The loaded entries without the ones hidden as done. */
export function withoutDoneWorkFeedEntries(
  entries: readonly WorkFeedEntry[],
  done: WorkFeedDone
): WorkFeedEntry[] {
  return entries.filter((entry) => done.get(entry.itemId) !== entry.revision);
}

/** Hide items as done at the revision each acknowledged. */
export function markWorkFeedDone(
  done: WorkFeedDone,
  items: readonly { itemId: string; revision: string }[]
): WorkFeedDone {
  const next = new Map(done);
  for (const item of items) next.set(item.itemId, item.revision);
  return next;
}

/** Show items again after an undone or failed done. */
export function unmarkWorkFeedDone(
  done: WorkFeedDone,
  itemIds: readonly string[]
): WorkFeedDone {
  const next = new Map(done);
  for (const itemId of itemIds) next.delete(itemId);
  return next;
}

/**
 * Forget done items a fresh read settled: the feed no longer holds them, or
 * holds them with newer reasons. Only items still shown at the acknowledged
 * revision stay hidden.
 */
export function settleWorkFeedDone(
  done: WorkFeedDone,
  entries: readonly WorkFeedEntry[]
): WorkFeedDone {
  if (done.size === 0) return done;
  const next = new Map<string, string>();
  for (const entry of entries) {
    if (done.get(entry.itemId) === entry.revision) {
      next.set(entry.itemId, entry.revision);
    }
  }
  return next;
}

/** The key Home rows and actions use to find an entity's work feed item. */
export const workFeedEntityKey = (entity: Pick<EntityData, 'type' | 'id'>) =>
  `${entity.type}:${entity.id}`;
