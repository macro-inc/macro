import type {
  SettingsTabGroup,
  SettingsTabItem,
} from '@core/constant/settingsTabsConfig';
import { fuzzyFilter } from '@core/util/fuzzy';

/** Label plus keywords, lowercased for the shared uFuzzy index. */
export function settingsTabSearchText(item: SettingsTabItem): string {
  return [item.label, ...item.keywords].join(' ').toLowerCase();
}

/**
 * Filters settings groups by a fuzzy query against each tab's label and
 * keywords. An empty query returns the standing nav and hides search-only
 * destinations such as Runtimes.
 */
export function filterSettingsTabGroups(
  groups: readonly SettingsTabGroup[],
  query: string
): SettingsTabGroup[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return groups
      .map((group) => ({
        label: group.label,
        items: group.items.filter((item) => !item.searchOnly),
      }))
      .filter((group) => group.items.length > 0);
  }

  return groups
    .map((group) => ({
      label: group.label,
      items: fuzzyFilter(trimmed, group.items, settingsTabSearchText),
    }))
    .filter((group) => group.items.length > 0);
}
