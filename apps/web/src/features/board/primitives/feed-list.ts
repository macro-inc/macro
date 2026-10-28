import { createListController } from '@app/components/list';
import { createKeyedProjection } from '@queries/soup/create-keyed-projection';
import { type Accessor, createMemo } from 'solid-js';
import type { BoardOlderActivity } from '../context/board-context';
import { type FeedItemRow, feedRows } from '../core/feed';
import type { BoardItem } from '../core/item';

/**
 * A list of every item, newest first under day headings, with keyboard
 * focus over the items and paging back in time. Rows keep their identity
 * while their contents change, so a refresh or a clock tick never remounts
 * the focused row.
 */
export function createFeedList(options: {
  items: Accessor<readonly BoardItem[]>;
  now: Accessor<number>;
  older?: BoardOlderActivity;
  onOpen: (key: string) => void;
}) {
  const rows = createKeyedProjection(
    () => feedRows(options.items(), options.now()),
    (row) => row.key,
    (row) => row
  );

  const itemRows = createMemo(() =>
    rows().filter((row): row is FeedItemRow => row.kind === 'item')
  );

  const list = createListController<FeedItemRow>({
    items: itemRows,
    getKey: (row) => row.key,
    onActivate: (activation) => options.onOpen(activation.item.item.key),
  });

  // Where each item sits among the rows, since headings sit between them.
  const rowIndexes = createMemo(() => {
    const indexes: number[] = [];
    rows().forEach((row, index) => {
      if (row.kind === 'item') indexes[row.index] = index;
    });
    return indexes;
  });

  const hasOlder = () => options.older?.hasMore() ?? false;
  const loadingOlder = () => options.older?.loading() ?? false;

  return {
    rows,
    list,
    /** The row an item's focus index points at. */
    rowIndex: (itemIndex: number) => rowIndexes()[itemIndex] ?? itemIndex,
    hasOlder,
    loadingOlder,
    /** Fetches the next page back, once at a time. */
    loadOlder: () => {
      if (!hasOlder() || loadingOlder()) return;
      options.older?.load();
    },
  };
}

export type FeedList = ReturnType<typeof createFeedList>;
