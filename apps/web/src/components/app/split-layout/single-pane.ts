import { type Accessor, createEffect, on } from 'solid-js';
import type { SplitManager } from './layoutManager';

/**
 * A caller with no account browses in one pane. The pane policy's
 * `singlePane` keeps opens from adding panes; this keeps what other paths
 * bring: a linked or restored URL with several panes, Back or Forward to one,
 * or signing out with several open. All but the active pane close.
 */
export function keepSinglePane(
  manager: SplitManager,
  singlePane: Accessor<boolean>
): void {
  createEffect(
    on(
      () =>
        singlePane() && manager.contentNavigationReady()
          ? manager.splits().map((split) => split.id)
          : [],
      (ids) => {
        if (ids.length < 2) return;
        const keep = manager.activeSplitId() ?? ids.at(-1);
        for (const id of ids) if (id !== keep) manager.removeSplit(id);
      }
    )
  );
}
