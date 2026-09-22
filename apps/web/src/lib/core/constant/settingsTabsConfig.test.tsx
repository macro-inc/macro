/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import {
  getSettingsTabItem,
  SETTINGS_TAB_GROUPS,
  settingsSlugToTab,
  settingsTabToSlug,
} from './settingsTabsConfig';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('../context/user', () => ({ useHasPermission: () => () => false }));

describe('unified agents settings navigation', () => {
  it('has one Agents entry in General rather than separate agent and harness pages', () => {
    const items = SETTINGS_TAB_GROUPS.flatMap((group) => group.items);
    expect(
      items
        .filter((item) => item.tab === 'Agents' || item.tab === 'Harness')
        .map((item) => item.label)
    ).toEqual(['Agents']);
    expect(
      SETTINGS_TAB_GROUPS.find((group) =>
        group.items.some((item) => item.tab === 'Agents')
      )?.label
    ).toBe('General');
  });

  it('uses runtimes for new links and preserves old pairing bookmarks', () => {
    expect(settingsTabToSlug('Harness')).toBe('runtimes');
    expect(settingsSlugToTab('runtimes')).toBe('Harness');
    expect(settingsSlugToTab('harness')).toBe('Harness');
    expect(getSettingsTabItem('Harness')?.label).toBe('Agents');
  });
});
