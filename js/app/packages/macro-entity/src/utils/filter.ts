import { createMemo, createSignal } from 'solid-js';
import {
  type EntityData,
  type EntityFilter,
  getEntityProjectId,
} from '../types/entity';
import type { WithNotification } from '../types/notification';

export function composeFilters<T extends EntityData>(
  ...filters: EntityFilter<T>[]
): EntityFilter<T> {
  return (entity: T) => filters.every((filter) => filter(entity));
}

export function createFilterComposer<T extends EntityData = EntityData>(
  initialFilters: EntityFilter<T>[] = []
) {
  const [filters, setFilters] = createSignal<EntityFilter<T>[]>(initialFilters);

  const filterFn = createMemo(() => composeFilters(...filters()));

  return {
    setFilters,
    filterFn,
  };
}

export function createProjectFilterFn(projectId: string) {
  return (entity: EntityData) => {
    return getEntityProjectId(entity) === projectId;
  };
}

export function unreadFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.isRead;
  return entity.notifications?.()?.some(({ viewedAt }) => !viewedAt) ?? false;
}

export function importantFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return entity.isImportant;
  return !!entity.notifications && entity.notifications().length > 0;
}

export function notDoneFilterFn(entity: WithNotification<EntityData>) {
  if (entity.type === 'email') return !entity.done;
  return (
    !!entity.notifications && entity.notifications().some(({ done }) => !done)
  );
}
