import { describe, expect, it } from 'vitest';
import { groupCatalogByCategory } from './catalog-categories';

describe('groupCatalogByCategory', () => {
  it('uses the first nonempty Pipedream category without duplicating apps', () => {
    const groups = groupCatalogByCategory([
      {
        app_slug: 'sheets',
        display_name: 'Sheets',
        categories: [' Productivity ', 'Data Analytics'],
      },
      {
        app_slug: 'slack',
        display_name: 'Slack',
        categories: ['', 'Communication'],
      },
      {
        app_slug: 'notion',
        display_name: 'Notion',
        categories: ['Productivity'],
      },
      { app_slug: 'unknown', display_name: 'Unknown' },
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      'Productivity',
      'Communication',
      'More apps',
    ]);
    expect(groups[0].entries.map((entry) => entry.app_slug)).toEqual([
      'sheets',
      'notion',
    ]);
    expect(groups.flatMap((group) => group.entries)).toHaveLength(4);
  });

  it('puts work categories first, remaining categories alphabetically, and uncategorized apps last', () => {
    const groups = groupCatalogByCategory([
      { app_slug: 'unknown', display_name: 'Unknown' },
      ...[
        'Travel',
        'Databases',
        'Developer Tools',
        'Security',
        'Productivity',
        'Communication',
        'Artificial Intelligence (AI)',
        'File Storage',
        'CRM',
      ].map((category) => ({
        app_slug: category,
        display_name: category,
        categories: [category],
      })),
    ]);
    expect(groups.map((group) => group.name)).toEqual([
      'Productivity',
      'Communication',
      'Developer Tools',
      'Artificial Intelligence (AI)',
      'File Storage',
      'CRM',
      'Databases',
      'Security',
      'Travel',
      'More apps',
    ]);
  });

  it('returns no sections for an empty result', () => {
    expect(groupCatalogByCategory([])).toEqual([]);
  });
});
