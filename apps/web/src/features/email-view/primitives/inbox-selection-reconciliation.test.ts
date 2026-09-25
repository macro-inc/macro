import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createInboxSelectionReconciliation } from './inbox-selection-reconciliation';

// No picker or drawer is mounted: reconciliation belongs to the view's lifetime.
function mount(selected: string[] | undefined = ['saved-inbox']) {
  return createRoot((dispose) => {
    const [selectedIds, setSelectedIds] = createSignal<string[] | undefined>(
      selected
    );
    const [loadedLinks, setLoadedLinks] = createSignal<{ id: string }[]>();
    const clearSelection = vi.fn(() => setSelectedIds(undefined));
    createInboxSelectionReconciliation({
      selectedIds,
      loadedLinks,
      clearSelection,
    });
    return {
      dispose,
      selectedIds,
      setSelectedIds,
      setLoadedLinks,
      clearSelection,
    };
  });
}

describe('inbox reconciliation without mounted pickers', () => {
  it.each([{ links: [] }, { links: [{ id: 'remaining-inbox' }] }])(
    'clears a removed saved inbox after links load, including when no accounts remain: %j',
    ({ links }) => {
      const view = mount();
      try {
        expect(view.selectedIds()).toEqual(['saved-inbox']);
        expect(view.clearSelection).not.toHaveBeenCalled();
        view.setLoadedLinks(links);
        expect(view.selectedIds()).toBeUndefined();
        expect(view.clearSelection).toHaveBeenCalledOnce();
      } finally {
        view.dispose();
      }
    }
  );

  it('retains a valid selection through unavailable results and clears it when a later successful result removes it', () => {
    const view = mount();
    try {
      view.setLoadedLinks([{ id: 'saved-inbox' }]);
      expect(view.clearSelection).not.toHaveBeenCalled();
      // Pending and failed queries both expose no successfully loaded links.
      view.setLoadedLinks(undefined);
      expect(view.selectedIds()).toEqual(['saved-inbox']);
      expect(view.clearSelection).not.toHaveBeenCalled();
      view.setLoadedLinks([{ id: 'remaining-inbox' }]);
      expect(view.selectedIds()).toBeUndefined();
      expect(view.clearSelection).toHaveBeenCalledOnce();
      view.setLoadedLinks([{ id: 'remaining-inbox' }]);
      expect(view.clearSelection).toHaveBeenCalledOnce();
    } finally {
      view.dispose();
    }
  });

  it('also reconciles subsequent selections without opening a picker', () => {
    const view = mount();
    try {
      view.setLoadedLinks([{ id: 'saved-inbox' }]);
      view.setSelectedIds(undefined);
      expect(view.clearSelection).not.toHaveBeenCalled();
      view.setSelectedIds(['removed-inbox']);
      expect(view.selectedIds()).toBeUndefined();
      expect(view.clearSelection).toHaveBeenCalledOnce();
    } finally {
      view.dispose();
    }
  });
});
