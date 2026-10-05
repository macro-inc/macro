import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { describe, expect, it } from 'vitest';
import { filterSettingsTabGroups } from './settingsSearch';

function tabsFor(query: string) {
  return filterSettingsTabGroups(SETTINGS_TAB_GROUPS, query).flatMap((group) =>
    group.items.map((item) => item.tab)
  );
}

describe('filterSettingsTabGroups', function () {
  it('hides search-only destinations when the query is empty', function () {
    expect(tabsFor('')).not.toContain('Harness');
    expect(tabsFor('   ')).not.toContain('Harness');
    expect(tabsFor('')).toContain('Agents');
  });

  it('sends cursor to runtimes instead of Macro API keys', function () {
    const tabs = tabsFor('cursor');
    expect(tabs).toContain('Harness');
    expect(tabs).not.toContain('API Keys');
  });

  it('fuzzy-matches a missing letter in a keyword', function () {
    expect(tabsFor('curso')).toContain('Harness');
    expect(tabsFor('curso')).not.toContain('API Keys');
  });

  it('matches keywords declared on the tab', function () {
    expect(tabsFor('hotkey')).toEqual(['Shortcuts']);
  });

  it('returns no groups when nothing matches', function () {
    expect(tabsFor('xyz123')).toEqual([]);
  });
});
