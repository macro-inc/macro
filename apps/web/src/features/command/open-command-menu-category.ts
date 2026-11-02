import { setActiveScope } from '@core/hotkey/state';
import { CommandState } from './state';
import type { CategoryFilter } from './types';

/** Opens the command menu on one category, as `o` then a letter does. */
export function openCommandMenuCategory(category: CategoryFilter) {
  setActiveScope('global');
  CommandState.setCategoryFilter(category);
  CommandState.setQuery('');
  CommandState.setSelectedIndex(0);
  CommandState.open();
}
