import type { ListView } from '@app/constants/list-views';
import type { EntityData } from '@entity';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

export interface ListNavigationSource {
  viewId: ListView;
  entities: Accessor<EntityData[]>;
  hasMore: Accessor<boolean>;
  loadMore: () => Promise<unknown>;
}

const [sources, setSources] = createSignal(
  new Map<string, ListNavigationSource>()
);

/** Owned by the list's persistent split slot, so it survives opening an item. */
export function registerListNavigationSource(
  id: string,
  source: ListNavigationSource
) {
  setSources((previous) => new Map(previous).set(id, source));
  onCleanup(() => {
    if (sources().get(id) !== source) return;
    setSources((previous) => {
      const next = new Map(previous);
      next.delete(id);
      return next;
    });
  });
}

export const getListNavigationSource = (id: string) => sources().get(id);
