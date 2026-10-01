import type { EntityData } from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import { onCleanup } from 'solid-js';
import type { SoupAstItemsData } from '../items';
import { withoutPendingGraphqlSoupDeletes } from './optimistic-deletions';
import {
  hasActivityAfterDone,
  type PendingGraphqlSoupDone,
  soupDoneNotifications,
  withPendingDoneIds,
} from './optimistic-done';

type Group = NonNullable<SoupAstItemsData['groups']>[number];
type Snapshot = {
  entity: EntityData;
  index: number;
  groups: { group: Group; index: number; itemIndex: number }[];
  item: NonNullable<SoupAstItemsData['itemsById']>[string] | undefined;
};

function reflectsIntent(
  entity: EntityData | undefined,
  snapshot: Snapshot | undefined,
  intent: PendingGraphqlSoupDone,
  excludesDone: boolean
): boolean {
  if (!entity) return intent.done && excludesDone;
  if (hasActivityAfterDone(entity, intent)) return true;
  if (entity.type === 'email') return entity.done === intent.done;
  if (entity.type === 'reminder')
    return (entity.completedAt != null) === intent.done;
  const notifications = soupDoneNotifications(
    entity,
    intent.scopeChannelThreads
  );
  const knownIds = soupDoneNotifications(
    snapshot?.entity ?? entity,
    intent.scopeChannelThreads
  )
    .filter(({ id }) => intent.notificationIds.has(id))
    .map(({ id }) => id);
  if (knownIds.length === 0) return false;
  return intent.done
    ? notifications.every(({ state }) => state === 'done') &&
        knownIds.every((id) =>
          notifications.some((n) => n.id === id && n.state === 'done')
        )
    : knownIds.every((id) =>
        notifications.some((n) => n.id === id && n.state !== 'done')
      );
}

function projectState(
  entity: EntityData,
  intent: PendingGraphqlSoupDone
): EntityData {
  if (hasActivityAfterDone(entity, intent)) return entity;
  if (entity.type === 'email' && entity.done !== intent.done) {
    return { ...entity, done: intent.done };
  }
  if (
    entity.type === 'reminder' &&
    (entity.completedAt != null) !== intent.done
  ) {
    return {
      ...entity,
      completedAt: intent.done
        ? new Date(intent.startedAt).toISOString()
        : null,
    };
  }
  return entity;
}

function captureSnapshot(
  data: SoupAstItemsData,
  entity: EntityData,
  index: number
): Snapshot {
  const copy = { ...entity };
  const attached = (entity as { notifications?: unknown }).notifications;
  if (Array.isArray(attached)) {
    // Query stores clear active edges in place when Done commits. Undo must
    // retain the original notification witnesses, not a proxy to the emptied edge.
    Object.assign(copy, {
      notifications: (attached as Notification[]).map((notification) => ({
        ...notification,
      })),
    });
  }
  return {
    entity: copy,
    index,
    groups: (data.groups ?? []).flatMap((group, groupIndex) => {
      const itemIndex = group.itemIds.indexOf(entity.id);
      return itemIndex < 0
        ? []
        : [
            {
              group: { ...group, itemIds: [...group.itemIds] },
              index: groupIndex,
              itemIndex,
            },
          ];
    }),
    item: data.itemsById?.[entity.id],
  };
}

function restoreSnapshots(
  data: SoupAstItemsData,
  restore: Snapshot[]
): SoupAstItemsData {
  if (restore.length === 0) return data;
  const entities = [...data.entities];
  const groups = data.groups ? [...data.groups] : undefined;
  const itemsById = data.itemsById ? { ...data.itemsById } : undefined;
  for (const snapshot of restore.sort((a, b) => a.index - b.index)) {
    const id = snapshot.entity.id;
    entities.splice(
      Math.min(snapshot.index, entities.length),
      0,
      snapshot.entity
    );
    if (itemsById && snapshot.item) itemsById[id] = snapshot.item;
    if (!groups) continue;
    for (const previous of snapshot.groups) {
      let groupIndex = groups.findIndex(
        (group) => group.key === previous.group.key
      );
      if (groupIndex < 0) {
        groupIndex = Math.min(previous.index, groups.length);
        groups.splice(groupIndex, 0, {
          ...previous.group,
          itemIds: [],
          totalCount: 0,
        });
      }
      const group = groups[groupIndex];
      if (group.itemIds.includes(id)) continue;
      const itemIds = [...group.itemIds];
      itemIds.splice(Math.min(previous.itemIndex, itemIds.length), 0, id);
      groups[groupIndex] = {
        ...group,
        itemIds,
        totalCount: group.totalCount + 1,
      };
    }
  }
  return { ...data, entities, groups, itemsById };
}

/**
 * A mounted query remembers only its own admitted rows for Undo. Snapshots are
 * weakly owned by the undo operation and discarded on any filter/sort change;
 * they never insert an entity into a view where its membership was not known.
 */
export function createGraphqlSoupDoneProjection() {
  const reader = {};
  let scope: string | undefined;
  let snapshots = new WeakMap<object, Map<string, Snapshot>>();
  let observed: readonly PendingGraphqlSoupDone[] = [];
  const detach = () => {
    for (const entry of observed) entry.unobserve(reader);
    observed = [];
  };
  onCleanup(detach);

  return (
    queryScope: string,
    data: SoupAstItemsData | undefined,
    pending: readonly PendingGraphqlSoupDone[],
    excludesDone: boolean,
    deletedIds: ReadonlySet<string>
  ): SoupAstItemsData | undefined => {
    detach();
    if (scope !== queryScope) {
      scope = queryScope;
      snapshots = new WeakMap();
    }
    if (!data) {
      // A pending/error read is not an acknowledgement of a previously admitted
      // row. Keep that reader's veto until it has data or actually unmounts.
      for (const entry of pending) {
        const remembered = snapshots.get(entry.operation);
        if ([...entry.entityIds].some((id) => remembered?.has(id))) {
          entry.observe(reader, false);
        }
      }
      observed = pending;
      return undefined;
    }
    if (pending.length === 0) {
      return withoutPendingGraphqlSoupDeletes(data, deletedIds);
    }

    const latest = new Map<string, PendingGraphqlSoupDone>();
    for (const entry of pending) {
      for (const id of entry.entityIds) latest.set(id, entry);
    }
    const raw = new Map(
      data.entities.map((entity, index) => [entity.id, { entity, index }])
    );
    const restore = pending.flatMap((entry) => {
      const restoring: Snapshot[] = [];
      let remembered = snapshots.get(entry.operation);
      if (!remembered) {
        remembered = new Map();
        snapshots.set(entry.operation, remembered);
      }
      let relevant = false;
      let acknowledged = true;
      for (const id of entry.entityIds) {
        if (latest.get(id) !== entry) continue;
        const current = raw.get(id);
        // Unfiltered document/channel recents have no entity-level done field.
        // Their inclusion rules are not notification-feed membership rules.
        if (
          current &&
          !excludesDone &&
          current.entity.type !== 'email' &&
          current.entity.type !== 'reminder'
        )
          continue;
        if (current && entry.done && !remembered.has(id)) {
          remembered.set(
            id,
            captureSnapshot(data, current.entity, current.index)
          );
        }
        const snapshot = remembered.get(id);
        if (!current && !snapshot) continue;
        relevant = true;
        acknowledged &&= reflectsIntent(
          current?.entity,
          snapshot,
          entry,
          excludesDone
        );
        if (
          !entry.done &&
          excludesDone &&
          !current &&
          snapshot &&
          !deletedIds.has(id)
        ) {
          restoring.push(snapshot);
        }
      }
      if (relevant) entry.observe(reader, acknowledged);
      return restoring;
    });
    observed = pending;

    let result = restoreSnapshots(data, restore);
    const entities = result.entities.map((entity) => {
      const intent = latest.get(entity.id);
      return intent ? projectState(entity, intent) : entity;
    });
    if (entities.some((entity, index) => entity !== result.entities[index])) {
      result = { ...result, entities };
    }
    return withoutPendingGraphqlSoupDeletes(
      result,
      excludesDone
        ? withPendingDoneIds(deletedIds, result.entities, pending)
        : deletedIds
    );
  };
}
