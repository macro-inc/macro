import { describe, expect, it, vi } from 'vitest';
import {
  getSettingsTabItem,
  SETTINGS_TAB_GROUPS,
  settingsSlugToTab,
  settingsTabToSlug,
} from './settingsTabsConfig';

vi.mock('@app/lib/analytics', () => ({ analytics: {} }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('../context/user', () => ({
  useHasPermission: () => () => true,
}));

describe('settings navigation', () => {
  it('combines agents and runtimes in one navigation entry', () => {
    expect(getSettingsTabItem('Agents')?.label).toBe('Agents & runtimes');
    expect(getSettingsTabItem('Harness')?.tab).toBe('Agents');
    expect(
      SETTINGS_TAB_GROUPS.flatMap((group) => group.items).filter(
        (item) => item.tab === 'Harness'
      )
    ).toEqual([]);
  });

  it('routes runtime and harness bookmarks to the combined page', () => {
    expect(settingsTabToSlug('Harness')).toBe('agents');
    expect(settingsSlugToTab('runtimes')).toBe('Agents');
    expect(settingsSlugToTab('harness')).toBe('Agents');
  });

  it('resolves every navigation tab from its canonical slug', () => {
    for (const group of SETTINGS_TAB_GROUPS) {
      for (const item of group.items) {
        expect(settingsSlugToTab(settingsTabToSlug(item.tab))).toBe(item.tab);
      }
    }
  });

  it('leaves unknown paths unresolved', () => {
    expect(settingsSlugToTab('runtime')).toBeUndefined();
    expect(settingsSlugToTab(null)).toBeUndefined();
  });
});
