import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import { createSignal } from 'solid-js';
import type { CategoryFilter } from './types';

/** Signal for whether the command menu is open */
export const [isOpen, setIsOpen] = createControlledOpenSignal();

/** Toggle the command menu visibility */
export function toggleCommandMenu() {
  setIsOpen(!isOpen());
}

/** Open the command menu */
export function openCommandMenu() {
  setIsOpen(true);
}

/** Close the command menu */
export function closeCommandMenu() {
  setIsOpen(false);
}

/** Signal for the search query */
export const [query, setQuery] = createSignal('');

/** Clear the search query */
export function clearQuery() {
  setQuery('');
}

/** Signal for the selected index in the list */
export const [selectedIndex, setSelectedIndex] = createSignal(0);

/** Reset the selected index to 0 */
export function resetSelectedIndex() {
  setSelectedIndex(0);
}

/** Signal for the active category filter */
export const [categoryFilter, setCategoryFilter] =
  createSignal<CategoryFilter>('all');

/** Reset category filter to 'all' */
export function resetCategoryFilter() {
  setCategoryFilter('all');
}

/** Timestamp of when the menu was last closed (for clearing state after timeout) */
export const [lastClosedTime, setLastClosedTime] = createSignal(0);

/** Reset all state when opening after a delay */
const STATE_RESET_THRESHOLD_MS = 5000;

export function maybeResetState() {
  const now = Date.now();
  if (now - lastClosedTime() >= STATE_RESET_THRESHOLD_MS) {
    clearQuery();
    resetSelectedIndex();
    resetCategoryFilter();
  }
}

/** Call when closing the menu */
export function onMenuClose() {
  setLastClosedTime(Date.now());
}
