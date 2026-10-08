/**
 * The actions menu's entries: the shortcut panel's actions, found by the
 * words of their names (and their group's).
 */

import { SHORTCUT_GROUPS, type ViewerAction } from './shortcuts';

export interface PaletteAction {
  id: ViewerAction;
  label: string;
  group: string;
  keys: string[];
  otherKeys?: string[];
}

/** The actions menu itself is not one of its entries. */
const ALL: PaletteAction[] = SHORTCUT_GROUPS.flatMap((g) =>
  g.items.flatMap((item) =>
    item.id && item.id !== 'open-actions'
      ? [
          {
            id: item.id,
            label: item.action,
            group: g.title,
            keys: item.keys,
            otherKeys: item.otherKeys,
          },
        ]
      : []
  )
);

/**
 * The entries matching `query`: every word starts a word of the name or
 * the group. Names starting with the query come first.
 */
export function paletteActions(query: string): PaletteAction[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ALL;
  const matches = ALL.filter((a) => {
    const haystack = `${a.label} ${a.group}`
      .toLowerCase()
      .split(/[^a-z0-9%]+/)
      .filter(Boolean);
    return words.every((w) => haystack.some((h) => h.startsWith(w)));
  });
  const q = query.trim().toLowerCase();
  const leading = (a: PaletteAction) =>
    a.label.toLowerCase().startsWith(q) ? 0 : 1;
  return [...matches].sort((a, b) => leading(a) - leading(b));
}
