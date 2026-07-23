import type { SoupRow } from '@app/features/next-soup/create-soup-state';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { type Accessor, createEffect, createMemo } from 'solid-js';

export function hasPreviewableSoupRows(rows: readonly SoupRow[]): boolean {
  return rows.some((row) => !row.getIsGrouped() && !row.getIsLoadMore());
}

/**
 * Tracks whether a Soup view has an entity that can be previewed and closes
 * its Preview Pair once a settled result contains no such entities.
 */
export function useSoupPreviewAvailability(options: {
  rows: Accessor<readonly SoupRow[]>;
  isLoading: Accessor<boolean>;
  splitHandle: SplitHandle;
}): Accessor<boolean> {
  const hasPreviewItems = createMemo(() =>
    hasPreviewableSoupRows(options.rows())
  );

  createEffect(() => {
    if (options.isLoading() || hasPreviewItems()) return;
    if (options.splitHandle.isControllerSplit()) {
      options.splitHandle.disengagePreview();
    }
  });

  return hasPreviewItems;
}
