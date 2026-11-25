import type { CommandListController } from '@ui';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';

/**
 * The row Enter acts on. While `guarded` holds (the first row would remove
 * values, such as Clear all), no row is highlighted until the person moves to
 * one with an arrow key or the pointer, so an Enter pressed as the editor
 * opens, or as its rows arrive, removes nothing. Typing starts over.
 */
export function createGuardedHighlight(options: {
  rows: Accessor<readonly unknown[]>;
  guarded: Accessor<boolean>;
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  listController: CommandListController<unknown>;
}) {
  const [movedToRow, setMovedToRow] = createSignal(false);
  createEffect(
    on(options.searchValue, () => setMovedToRow(false), { defer: true })
  );

  const highlightedIndex = () =>
    movedToRow() || !options.guarded() ? options.selectedIndex() : -1;

  const moveToRow = () => {
    if (options.rows().length === 0) return false;
    setMovedToRow(true);
    return true;
  };

  return {
    highlightedIndex,
    selectNext: () => {
      if (highlightedIndex() !== -1) {
        options.listController.selectNext();
        return;
      }
      if (moveToRow()) options.listController.setSelectedIndex(0);
    },
    selectPrevious: () => {
      if (moveToRow()) options.listController.selectPrevious();
    },
    selectFromPointer: (index: number) => {
      if (moveToRow())
        options.listController.setSelectedIndexFromPointer(index);
    },
  };
}
