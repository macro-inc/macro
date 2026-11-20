/** Semantic sections shared by context menus, more menus, and action sheets. */
export const MENU_GROUP_ORDER = [
  'open',
  'most-used',
  'copy',
  'modify',
  'share-export',
  'state',
  'info',
  'delete',
] as const;

export type MenuGroup = (typeof MENU_GROUP_ORDER)[number];

export type MenuSection<T> = {
  id: MenuGroup;
  items: T[];
};

/**
 * Order sections without changing the actions, their eligibility, or their
 * within-section order. Keep references intact: menu metadata can have getters.
 */
export function groupMenuItems<T>(
  items: readonly T[],
  groupOf: (item: T) => MenuGroup
): MenuSection<T>[] {
  const sections: MenuSection<T>[] = MENU_GROUP_ORDER.map((id) => ({
    id,
    items: [],
  }));
  const byGroup = new Map(sections.map((section) => [section.id, section]));

  for (const item of items) {
    byGroup.get(groupOf(item))!.items.push(item);
  }

  return sections.filter((section) => section.items.length > 0);
}
