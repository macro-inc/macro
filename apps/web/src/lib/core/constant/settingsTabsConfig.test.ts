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
    expect(workspace?.items.map((item) => item.tab)).toEqual([
      'Team',
      'Tags',
      'CRM',
      'Connected',
      'Connections',
      'Agent',
      'Bots',
    ]);
  });
});
