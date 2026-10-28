import { createListController } from '@app/components/list/create-list-controller';
import { createSignal } from 'solid-js';
import type { DriveListItem, DriveListSource } from '../context/drive-source';

export type DriveListActivationMetadata = {
  event?: MouseEvent;
  newSplit?: boolean;
};

export type DriveListSnapshot = {
  focusKey?: string;
  scrollOffset: number;
};

/** Entry state can come from an older build or an external navigation target. */
export function parseDriveListSnapshot(
  value: unknown
): DriveListSnapshot | undefined {
  if (!value || typeof value !== 'object') return;

  const focusKey =
    'focusKey' in value && typeof value.focusKey === 'string'
      ? value.focusKey
      : undefined;

  const scrollOffset =
    'scrollOffset' in value &&
    typeof value.scrollOffset === 'number' &&
    Number.isFinite(value.scrollOffset)
      ? Math.max(0, value.scrollOffset)
      : 0;

  return { focusKey, scrollOffset };
}

/** Owned by the workspace, so opening an inline detail does not reset the list. */
export function createDriveList(options: {
  source: DriveListSource;
  initial?: DriveListSnapshot;
  onActivate: (
    item: DriveListItem,
    metadata?: DriveListActivationMetadata
  ) => void;
}) {
  const [scrollOffset, setScrollOffset] = createSignal(
    options.initial?.scrollOffset ?? 0
  );

  const controller = createListController<
    DriveListItem,
    DriveListActivationMetadata
  >({
    items: options.source.items,

    getKey: (row) => row.id,

    onActivate: ({ item, metadata }) => options.onActivate(item, metadata),
  });

  if (options.initial?.focusKey) {
    controller.focus.restore(options.initial.focusKey, { reason: 'restore' });
  }

  return {
    controller,
    scrollOffset,
    setScrollOffset,

    snapshot: (): DriveListSnapshot => ({
      focusKey: controller.focus.requestedKey(),
      scrollOffset: scrollOffset(),
    }),

    reset: () => {
      controller.selection.clear();
      controller.focus.clear();
      setScrollOffset(0);
    },
  };
}

export type DriveListState = ReturnType<typeof createDriveList>;
