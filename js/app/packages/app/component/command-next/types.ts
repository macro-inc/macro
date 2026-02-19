/**
 * Types for the command menu.
 * Most item types come from QuickAccess - we just define the category filter here.
 */

/** Category filter options for the command menu */
export type CategoryFilter =
  | 'all'
  | 'documents'
  | 'channels'
  | 'chats'
  | 'commands'
  | 'people';

export interface CategoryOption {
  id: CategoryFilter;
  label: string;
}

export const CATEGORY_OPTIONS: CategoryOption[] = [
  { id: 'all', label: 'Everything' },
  { id: 'documents', label: 'Documents' },
  { id: 'channels', label: 'Channels' },
  { id: 'chats', label: 'Chats' },
  { id: 'people', label: 'People' },
  { id: 'commands', label: 'Commands' },
];
