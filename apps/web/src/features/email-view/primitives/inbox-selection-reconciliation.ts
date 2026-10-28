import { type Accessor, createEffect, untrack } from 'solid-js';

/** Reconcile saved scope only against successfully loaded accounts, independently of UI. */
export function createInboxSelectionReconciliation(options: {
  selectedIds: Accessor<readonly string[] | undefined>;
  loadedLinks: Accessor<readonly { id: string }[] | undefined>;
  clearSelection: () => void;
}) {
  createEffect(() => {
    const links = options.loadedLinks();
    if (links === undefined) return;
    if (
      options.selectedIds()?.some((id) => !links.some((link) => link.id === id))
    ) {
      untrack(options.clearSelection);
    }
  });
}
