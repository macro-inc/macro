import type { PipedreamCatalogEntryResponse } from '@service-cognition/client';

const CATEGORY_ORDER = [
  'Productivity',
  'Communication',
  'Developer Tools',
  'Artificial Intelligence (AI)',
  'File Storage',
  'CRM',
  'Business Management',
  'Data Analytics',
  'Databases',
];
const UNCATEGORIZED_LABEL = 'More apps';

function categoryRank(name: string) {
  const index = CATEGORY_ORDER.indexOf(name);
  return index < 0 ? CATEGORY_ORDER.length : index;
}

/** Group each app once, using Pipedream's first category and preserving its ranking. */
export function groupCatalogByCategory(
  entries: PipedreamCatalogEntryResponse[]
) {
  const groups = new Map<string, PipedreamCatalogEntryResponse[]>();
  for (const entry of entries) {
    const name =
      entry.categories?.find((category) => category.trim())?.trim() ??
      UNCATEGORIZED_LABEL;
    const group = groups.get(name) ?? [];
    group.push(entry);
    groups.set(name, group);
  }
  return [...groups]
    .map(([name, entries]) => ({ name, entries }))
    .sort((a, b) => {
      return (
        Number(a.name === UNCATEGORIZED_LABEL) -
          Number(b.name === UNCATEGORIZED_LABEL) ||
        categoryRank(a.name) - categoryRank(b.name) ||
        a.name.localeCompare(b.name)
      );
    });
}
