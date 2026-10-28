import type { CreatableBlock } from '../types';

// Kept apart from create-menu-details so the startup launcher doesn't pull in
// the create menu's details table.

/** The creatable's stable English name, independent of the interface language. */
export function creatableId(item: CreatableBlock): string {
  return item.id ?? item.label;
}

/** The creatable's command description, resolved for display. */
export function creatableDescription(item: CreatableBlock): string {
  return typeof item.description === 'function'
    ? item.description()
    : item.description;
}
