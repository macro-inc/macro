import { describe, expect, it } from 'vitest';
import {
  SETTINGS_TAB_GROUPS,
  settingsSlugToTab,
  settingsTabToSlug,
} from './settingsTabsConfig';

describe('settings Connections tab', () => {
  it('routes agent-connections to the Connections tab', () => {
    expect(settingsSlugToTab('agent-connections')).toBe('Connections');
    expect(settingsTabToSlug('Connections')).toBe('agent-connections');
  });

  it('keeps the connections slug on Integrations', () => {
    expect(settingsSlugToTab('connections')).toBe('Connected');
  });

  it('places Connections right after Integrations in Workspace', () => {
    const workspace = SETTINGS_TAB_GROUPS.find(
      (group) => group.label === 'Workspace'
    );
    const tabs = workspace?.items.map((item) => item.tab) ?? [];
    const integrations = tabs.indexOf('Connected');
    expect(tabs.slice(integrations, integrations + 2)).toEqual([
      'Connected',
      'Connections',
    ]);
  });
});
