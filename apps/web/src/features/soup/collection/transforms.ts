import type { SoupEntityIdentity, SoupGroup } from './types';

export type DeduplicateItemsOptions<TItem> = {
  getKey: (item: TItem) => string;
  resolveConflict?: (existing: TItem, incoming: TItem) => TItem;
};

export function deduplicateItems<TItem>(
  items: TItem[],
  options: DeduplicateItemsOptions<TItem>
): TItem[] {
  const result: TItem[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const key = options.getKey(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, result.length);
      result.push(item);
      continue;
    }

    if (options.resolveConflict) {
      result[existingIndex] = options.resolveConflict(
        result[existingIndex],
        item
      );
    }
  }

  return result;
}

export const deduplicateSoupEntities = <TEntity extends SoupEntityIdentity>(
  entities: TEntity[],
  resolveConflict?: (existing: TEntity, incoming: TEntity) => TEntity
): TEntity[] =>
  deduplicateItems(entities, {
    getKey: (entity) => entity.id,
    resolveConflict,
  });

/**
 * Moves caller-prioritized keys to the front while preserving all relative
 * order not explicitly controlled by the priority sequence.
 */
export function prioritizeItems<TItem>(
  items: TItem[],
  priorityKeys: string[],
  getKey: (item: TItem) => string
): TItem[] {
  const priority = new Map<string, number>();
  priorityKeys.forEach((key, index) => {
    if (!priority.has(key)) priority.set(key, index);
  });
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const leftPriority = priority.get(getKey(left.item));
      const rightPriority = priority.get(getKey(right.item));
      if (leftPriority === undefined && rightPriority === undefined) {
        return left.index - right.index;
      }
      if (leftPriority === undefined) return 1;
      if (rightPriority === undefined) return -1;
      return leftPriority - rightPriority || left.index - right.index;
    })
    .map(({ item }) => item);
}

export type SortDefinition<TItem, TId extends string = string> = {
  id: TId;
  compare: (left: TItem, right: TItem) => number;
};

export type SortSelection<TId extends string = string> = {
  id: TId;
  reversed?: boolean;
};

export function sortItems<TItem, TId extends string>(
  items: TItem[],
  selections: SortSelection<TId>[],
  definitions: SortDefinition<TItem, TId>[]
): TItem[] {
  const byId = new Map<TId, SortDefinition<TItem, TId>>();
  for (const definition of definitions) {
    if (byId.has(definition.id)) {
      throw new Error(
        `Sort definitions must have unique IDs; received: ${definition.id}`
      );
    }
    byId.set(definition.id, definition);
  }
  const comparators = selections.flatMap((selection) => {
    const definition = byId.get(selection.id);
    if (!definition) return [];
    const direction = selection.reversed ? -1 : 1;
    return [
      (left: TItem, right: TItem) =>
        direction * definition.compare(left, right),
    ];
  });

  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      for (const compare of comparators) {
        const result = compare(left.item, right.item);
        if (result !== 0) return result;
      }
      return left.index - right.index;
    })
    .map(({ item }) => item);
}

export type GroupSoupEntitiesOptions<TEntity extends SoupEntityIdentity> = {
  getGroupId: (entity: TEntity) => string;
  getGroupLabel: (
    groupId: string,
    firstEntity: TEntity,
    entities: TEntity[]
  ) => string;
  compareGroups?: (
    left: SoupGroup<TEntity>,
    right: SoupGroup<TEntity>
  ) => number;
};

export function groupSoupEntities<TEntity extends SoupEntityIdentity>(
  entities: TEntity[],
  options: GroupSoupEntitiesOptions<TEntity>
): SoupGroup<TEntity>[] {
  const grouped = new Map<string, TEntity[]>();
  for (const entity of entities) {
    const groupId = options.getGroupId(entity);
    const group = grouped.get(groupId);
    if (group) group.push(entity);
    else grouped.set(groupId, [entity]);
  }

  const groups = [...grouped].map(([id, groupEntities]) => ({
    id,
    label: options.getGroupLabel(id, groupEntities[0], groupEntities),
    entities: groupEntities,
    count: groupEntities.length,
  }));

  if (!options.compareGroups) return groups;
  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (left, right) =>
        options.compareGroups?.(left.group, right.group) ||
        left.index - right.index
    )
    .map(({ group }) => group);
}
