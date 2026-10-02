import { type Accessor, createSignal, onMount } from 'solid-js';
import type { MoreMenuItemId } from './nav-items';

const STORAGE_KEY = 'macro:sidebar:pinned-items';

/**
 * Load pinned items from localStorage.
 */
function loadPinnedItems(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        return new Set(parsed);
      }
    }
  } catch {
    // Ignore parse errors
  }
  return new Set();
}

/**
 * Save pinned items to localStorage.
 */
function savePinnedItems(items: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...items]));
  } catch {
    // Ignore storage errors
  }
}

const [pinnedItems, setPinnedItems] = createSignal<Set<string>>(new Set());
let initialized = false;

/**
 * Hook to access and manage pinned sidebar items.
 * Returns the current set of pinned item IDs.
 */
export function useSidebarPinnedItems(): Accessor<Set<string>> {
  onMount(() => {
    if (!initialized) {
      setPinnedItems(loadPinnedItems());
      initialized = true;
    }
  });
  return pinnedItems;
}

/**
 * Pin an item to the main sidebar (remove from More menu).
 */
export function pinSidebarItem(itemId: MoreMenuItemId): void {
  setPinnedItems((prev) => {
    const next = new Set(prev);
    next.add(itemId);
    savePinnedItems(next);
    return next;
  });
}

/**
 * Unpin an item from the main sidebar (move to More menu).
 */
export function unpinSidebarItem(itemId: MoreMenuItemId): void {
  setPinnedItems((prev) => {
    const next = new Set(prev);
    next.delete(itemId);
    savePinnedItems(next);
    return next;
  });
}

/**
 * Check if an item is currently pinned.
 */
export function isSidebarItemPinned(itemId: string): boolean {
  return pinnedItems().has(itemId);
}
