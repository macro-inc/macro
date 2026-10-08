import { createAssertedContextProvider } from '@core/context/createContext';
import { createSignal, onMount } from 'solid-js';

const STORAGE_KEY = 'macro:sidebar:prefs';
const LEGACY_PINNED_KEY = 'macro:sidebar:pinned-items';

/** Items hidden from the rail by default (reachable via the More menu). */
export const DEFAULT_HIDDEN_IDS = ['calls', 'reviews'] as const;

export type SidebarPrefs = {
  /** Item ids hidden from the outer rail. Home is never included. */
  hidden: Set<string>;
  /** Custom rail order. Missing ids fall back to the default catalog order. */
  order: string[];
};

type StoredPrefs = {
  hidden?: string[];
  order?: string[];
};

function defaultPrefs(): SidebarPrefs {
  return {
    hidden: new Set(DEFAULT_HIDDEN_IDS),
    order: [],
  };
}

function loadPrefs(): SidebarPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredPrefs;
      return {
        hidden: new Set((parsed.hidden ?? []).filter((id) => id !== 'home')),
        order: Array.isArray(parsed.order) ? parsed.order : [],
      };
    }

    // Migrate the short-lived pinned-items key (calls/reviews only).
    const legacy = localStorage.getItem(LEGACY_PINNED_KEY);
    if (legacy) {
      const pinned = JSON.parse(legacy);
      if (Array.isArray(pinned)) {
        const pinnedSet = new Set(pinned as string[]);
        const hidden = DEFAULT_HIDDEN_IDS.filter((id) => !pinnedSet.has(id));
        localStorage.removeItem(LEGACY_PINNED_KEY);
        const prefs = { hidden: new Set(hidden), order: [] as string[] };
        savePrefs(prefs);
        return prefs;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return defaultPrefs();
}

function savePrefs(prefs: SidebarPrefs): void {
  try {
    const payload: StoredPrefs = {
      hidden: [...prefs.hidden].filter((id) => id !== 'home'),
      order: prefs.order,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage errors
  }
}

export const [SidebarPrefsProvider, useSidebarPrefs] =
  createAssertedContextProvider('SidebarPrefs', () => {
    const [prefs, setPrefs] = createSignal<SidebarPrefs>(defaultPrefs());
    onMount(() => setPrefs(loadPrefs()));

    function updatePrefs(
      mutator: (current: SidebarPrefs) => SidebarPrefs
    ): void {
      setPrefs((current) => {
        const next = mutator(current);
        savePrefs(next);
        return next;
      });
    }

    /** Hide an item from the outer rail (Home is ignored). */
    function hideSidebarItem(itemId: string): void {
      if (itemId === 'home') return;
      updatePrefs((current) => {
        const hidden = new Set(current.hidden);
        hidden.add(itemId);
        return { ...current, hidden };
      });
    }

    /** Show an item on the outer rail. */
    function showSidebarItem(itemId: string): void {
      updatePrefs((current) => {
        const hidden = new Set(current.hidden);
        hidden.delete(itemId);
        return { ...current, hidden };
      });
    }

    /** Toggle whether an item is visible on the outer rail. */
    function setSidebarItemVisible(itemId: string, visible: boolean): void {
      if (visible) showSidebarItem(itemId);
      else hideSidebarItem(itemId);
    }

    /**
     * Reorder items by moving the item at `fromIndex` to `toIndex`.
     * Home stays pinned at index 0 when present.
     */
    function reorderSidebarItems(
      fromIndex: number,
      toIndex: number,
      orderIds: readonly string[]
    ): void {
      if (fromIndex === toIndex) return;
      if (fromIndex < 0 || toIndex < 0) return;
      if (fromIndex >= orderIds.length || toIndex >= orderIds.length) return;

      const nextOrder = [...orderIds];
      const [removed] = nextOrder.splice(fromIndex, 1);
      if (removed === 'home') return;
      nextOrder.splice(toIndex, 0, removed);

      // Keep Home first if it was in the list.
      const homeIndex = nextOrder.indexOf('home');
      if (homeIndex > 0) {
        nextOrder.splice(homeIndex, 1);
        nextOrder.unshift('home');
      }

      updatePrefs((current) => ({ ...current, order: nextOrder }));
    }

    return {
      prefs,
      hideSidebarItem,
      setSidebarItemVisible,
      reorderSidebarItems,
    };
  });
