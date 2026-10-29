import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from 'solid-js';
import type { EntitySearchCategory } from '../queries/entity-search';

// History remembers a small ordering hint; the source owns all row objects.
const MAX_SAVED_RESULT_IDS = 200;
type SearchResultOrder = {
  accountId: string;
  query: string;
  category: EntitySearchCategory;
  ids: string[];
};

export function createSearchResultWindow<T extends { id: string }>(options: {
  key: string;
  accountId: Accessor<string>;
  query: Accessor<string>;
  category: Accessor<EntitySearchCategory>;
  items: Accessor<T[]>;
  itemKey?: (item: T) => string;
  discard: Accessor<boolean>;
}) {
  const { handle } = useSplitPanelOrThrow();
  const itemKey = options.itemKey ?? ((item: T) => item.id);
  const stored = untrack(() => handle.currentEntryState()?.[options.key]) as
    | SearchResultOrder
    | undefined;
  const scope = createMemo(() => ({
    accountId: options.accountId(),
    query: options.query(),
    category: options.category(),
  }));
  const [order, setOrder] = createSignal(
    untrack(() => {
      const current = scope();
      return stored?.accountId === current.accountId &&
        stored.query === current.query &&
        stored.category === current.category
        ? { scope: current, ids: stored.ids }
        : undefined;
    })
  );
  const items = createMemo(() => {
    const current = scope();
    const saved = order();
    const incoming = options.items();
    if (options.discard() || !saved || saved.scope !== current) return incoming;
    const remaining = new Map(incoming.map((item) => [itemKey(item), item]));
    const ordered: T[] = [];
    for (const id of saved.ids) {
      const item = remaining.get(id);
      if (!item) continue;
      ordered.push(item);
      remaining.delete(id);
    }
    return [...ordered, ...remaining.values()];
  });
  const preserveOrder = () =>
    setOrder({
      scope: scope(),
      ids: items().slice(0, MAX_SAVED_RESULT_IDS).map(itemKey),
    });
  onCleanup(
    handle.registerEntryStateCaptor(options.key, () => {
      preserveOrder();
      // Never return row objects, source callbacks, or virtualizer caches.
      const saved = order();
      return saved ? { ...saved.scope, ids: saved.ids } : undefined;
    })
  );
  return { items, preserveOrder };
}
