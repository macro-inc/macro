export type ListItemSnapshot<T> = {
  index: number;
  item: T;
};

export function insertItemIfMissing<T extends { id: string }>(
  items: T[] | undefined,
  item: T
): T[] | undefined {
  if (!items) return [item];
  if (items.some((existingItem) => existingItem.id === item.id)) {
    return items;
  }
  return [...items, item];
}

export function removeItemById<T extends { id: string }>(
  items: T[] | undefined,
  id: string
): T[] | undefined {
  if (!items) return items;
  const nextItems = items.filter((item) => item.id !== id);
  return nextItems.length === items.length ? items : nextItems;
}

export function replaceItemId<T extends { id: string }>(
  items: T[] | undefined,
  optimisticId: string,
  realId: string
): T[] | undefined {
  if (!items) return items;

  let didChange = false;
  const nextItems = items.map((item) => {
    if (item.id !== optimisticId) return item;
    didChange = true;
    return { ...item, id: realId };
  });

  return didChange ? nextItems : items;
}

export function captureItemSnapshotById<T extends { id: string }>(
  items: T[] | undefined,
  id: string
): ListItemSnapshot<T> | undefined {
  if (!items) return undefined;

  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return undefined;

  return {
    index,
    item: items[index],
  };
}

export function restoreItemSnapshot<T extends { id: string }>(
  items: T[] | undefined,
  snapshot: ListItemSnapshot<T>
): T[] | undefined {
  if (!items) return [snapshot.item];
  if (items.some((item) => item.id === snapshot.item.id)) {
    return items;
  }

  const nextItems = [...items];
  nextItems.splice(snapshot.index, 0, snapshot.item);
  return nextItems;
}
