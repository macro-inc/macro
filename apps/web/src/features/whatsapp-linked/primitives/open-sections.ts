import {
  type CollapsedSidebarSectionsState,
  createCollapsedSidebarSectionsStorage,
  setSidebarSectionCollapsed,
} from '@app/components/view-shell/collapsed-sections';
import { makePersistedState } from '@app/lib/persistence';
import { type Accessor, createEffect, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { OpenSections } from '../context/whatsapp-linked-context';

/**
 * Open and closed sections, remembered per person under `storageKey` with
 * the view shell's folded-section storage (as Email and Tasks do). Unknown
 * sections start open.
 */
export function createOpenSections(
  storageKey: string,
  userId: Accessor<string | undefined>
): OpenSections {
  const storage =
    createCollapsedSidebarSectionsStorage<CollapsedSidebarSectionsState>({
      key: storageKey,
      userId,
      restore: true,
    });
  const [state, setState] = makePersistedState(
    createStore<CollapsedSidebarSectionsState>({
      collapsedSidebarSectionIds: [],
    }),
    { storages: storage }
  );
  // The signed-in user can arrive after the list mounts, e.g. on a reload.
  createEffect(
    on(
      userId,
      () => {
        const restored = storage.restore(state);
        if (restored)
          setState(
            'collapsedSidebarSectionIds',
            restored.collapsedSidebarSectionIds
          );
      },
      { defer: true }
    )
  );
  return {
    isOpen: (sectionId) =>
      !state.collapsedSidebarSectionIds.includes(sectionId),
    setOpen: (sectionId, open) =>
      setState(
        'collapsedSidebarSectionIds',
        setSidebarSectionCollapsed(sectionId, open)
      ),
  };
}
