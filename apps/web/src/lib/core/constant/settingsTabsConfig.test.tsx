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
  it('presents the runtime settings as Runtimes', () => {
    expect(getSettingsTabItem('Harness')?.label).toBe('Runtimes');
  });

  it('creates runtime URLs while accepting bookmarked harness URLs', () => {
    expect(settingsTabToSlug('Harness')).toBe('runtimes');
    expect(settingsSlugToTab('runtimes')).toBe('Harness');
    expect(settingsSlugToTab('harness')).toBe('Harness');
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
