import type { SoupRow } from '@app/features/next-soup/create-soup-state';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { type Accessor, createEffect, createMemo } from 'solid-js';

export function hasPreviewableSoupRows(rows: readonly SoupRow[]): boolean {
  return rows.some((row) => !row.getIsGrouped() && !row.getIsLoadMore());
}

/**
 * Tracks whether a Soup view has an entity that can be previewed and closes
 * its Preview Pair once a settled result contains no such entities.
 *
 * A result is only settled once nothing is in flight. `isLoading` alone
 * doesn't cover a tab switch: both soup sources keep the previous tab's rows
 * on screen while the next tab's (uncached) query loads, and those rows are
 * immediately re-filtered by the next tab's client predicates. When none of
 * them match (e.g. Signal rows never match Noise), rows are transiently empty
 * while `isLoading` is already false — so the fetch state must also hold the
 * preview open.
 */
export function useSoupPreviewAvailability(options: {
  rows: Accessor<readonly SoupRow[]>;
  isLoading: Accessor<boolean>;
  /** True while any fetch for the active filters is in flight. */
  isFetching: Accessor<boolean>;
  /** True while rows still belong to the previous query key (tab switch). */
  isPlaceholderData: Accessor<boolean>;
  splitHandle: SplitHandle;
}): Accessor<boolean> {
  const hasPreviewItems = createMemo(() =>
    hasPreviewableSoupRows(options.rows())
  );

  const isSettled = () =>
    !options.isLoading() &&
    !options.isFetching() &&
    !options.isPlaceholderData();

  createEffect(() => {
    if (!isSettled() || hasPreviewItems()) return;
    if (options.splitHandle.isControllerSplit()) {
      options.splitHandle.disengagePreview();
    }
  });

  return hasPreviewItems;
}
