export { CommandMenu } from './CommandMenu';
export {
  isOpen,
  setIsOpen,
  toggleCommandMenu,
  openCommandMenu,
  closeCommandMenu,
  query,
  setQuery,
  clearQuery,
  selectedIndex,
  setSelectedIndex,
  categoryFilter,
  setCategoryFilter,
} from './state';
export type { CategoryFilter, CategoryOption } from './types';
export { CATEGORY_OPTIONS } from './types';

// Re-export QuickAccess types for convenience
export {
  useCommandItems,
  useFilteredItems,
  isEntityItem,
  isUserItem,
  isCommandItem,
} from './useCommandItems';
export type { QuickAccessItem, Bucket } from './useCommandItems';
