import { createAssertedContextProvider } from '@core/context/createContext';
import { createSignal, onMount } from 'solid-js';

const STORAGE_KEY = 'macro:sidebar:prefs';
const LEGACY_PINNED_KEY = 'macro:sidebar:pinned-items';

/** Items hidden from the rail by default (reachable via the More menu). */
export const DEFAULT_HIDDEN_IDS = [
  'calls',
  'reviews',
  'booking-links',
  'activity',
] as const;

/** The window edge the rail docks to. */
export type RailPosition = 'left' | 'right' | 'top' | 'bottom';
const RAIL_POSITIONS: readonly RailPosition[] = [
  'left',
  'right',
  'top',
  'bottom',
];

/** Large is the original 56px rail; small is narrower with smaller glyphs. */
export type RailSize = 'large' | 'small';
const RAIL_SIZES: readonly RailSize[] = ['large', 'small'];

export type SidebarPrefs = {
  /** Item ids hidden from the outer rail. Home is never included. */
  hidden: Set<string>;
  /** Custom rail order. Missing ids fall back to the default catalog order. */
  order: string[];
  position: RailPosition;
  size: RailSize;
};

type StoredPrefs = {
  version?: 1 | 2;
  hidden?: string[];
  order?: string[];
  position?: string;
  size?: string;
};

function defaultPrefs(): SidebarPrefs {
  return {
    hidden: new Set(DEFAULT_HIDDEN_IDS),
    order: [],
    position: 'left',
    size: 'large',
  };
}

function parsePosition(value: string | undefined): RailPosition {
  return RAIL_POSITIONS.find((position) => position === value) ?? 'left';
}

function parseSize(value: string | undefined): RailSize {
  return RAIL_SIZES.find((size) => size === value) ?? 'large';
}

function loadPrefs(): SidebarPrefs {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as StoredPrefs;
      const hidden = (parsed.hidden ?? []).filter((id) => id !== 'home');
      // Scheduling was previously More-only, before it became customizable.
      if (parsed.version === undefined && !hidden.includes('booking-links')) {
        hidden.push('booking-links');
      }
      // Activity joined the rail after version 1; start it in More.
      if ((parsed.version ?? 0) < 2 && !hidden.includes('activity')) {
        hidden.push('activity');
      }
      return {
        hidden: new Set(hidden),
        order: Array.isArray(parsed.order) ? parsed.order : [],
        position: parsePosition(parsed.position),
        size: parseSize(parsed.size),
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
        const prefs = { ...defaultPrefs(), hidden: new Set<string>(hidden) };
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
      version: 2,
      hidden: [...prefs.hidden].filter((id) => id !== 'home'),
      order: prefs.order,
      position: prefs.position,
      size: prefs.size,
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

    /** Dock the rail to another window edge. */
    function setRailPosition(position: RailPosition): void {
      if (prefs().position === position) return;
      updatePrefs((current) => ({ ...current, position }));
    }

    function setRailSize(size: RailSize): void {
      if (prefs().size === size) return;
      updatePrefs((current) => ({ ...current, size }));
    }

    return {
      prefs,
      setRailPosition,
      setRailSize,
      hideSidebarItem,
      setSidebarItemVisible,
      reorderSidebarItems,
    };
  });

/** The page-facing side of each docked rail: where its tooltips and menus open. */
const RAIL_FACING = {
  left: 'right',
  right: 'left',
  top: 'bottom',
  bottom: 'top',
} as const satisfies Record<RailPosition, RailPosition>;

/**
 * Placement for a rail control's tooltip or popover, opening towards the page
 * whichever edge the rail is docked to. `align` keeps a menu's start or end
 * edge flush with its trigger.
 */
export function useRailPlacement() {
  const { prefs } = useSidebarPrefs();
  const facing = () => RAIL_FACING[prefs().position];
  return {
    facing,
    aligned: (align: 'start' | 'end') => `${facing()}-${align}` as const,
  };
}
