import { describe, expect, it } from 'vitest';
import {
  SETTINGS_TAB_GROUPS,
  settingsSlugToTab,
  settingsTabToSlug,
} from './settingsTabsConfig';

describe('settings navigation', () => {
  it('gives calendar connections and booking links separate routes', () => {
    expect(settingsSlugToTab('calendar')).toBe('Calendar');
    expect(settingsSlugToTab('booking-links')).toBe('Booking links');
    expect(settingsTabToSlug('Booking links')).toBe('booking-links');
  });
  it('routes agent-connections to the Connections tab', () => {
    expect(settingsSlugToTab('agent-connections')).toBe('Connections');
    expect(settingsTabToSlug('Connections')).toBe('agent-connections');
  });

  it('keeps the connections slug on Integrations', () => {
    expect(settingsSlugToTab('connections')).toBe('Connected');
  });

  it('groups blocks first and separates account and agent integrations', () => {
    expect(SETTINGS_TAB_GROUPS[0].label).toBe('Blocks');
    expect(SETTINGS_TAB_GROUPS[0].items.map((item) => item.tab)).toEqual([
      'Email',
      'Calendar',
      'Booking links',
      'Agents',
      'CRM',
    ]);
    const workspace = SETTINGS_TAB_GROUPS.find(
      (group) => group.label === 'Workspace'
    );
    const developer = SETTINGS_TAB_GROUPS.find(
      (group) => group.label === 'Developer'
    );
    expect(workspace?.items.map((item) => item.tab)).toContain('Connected');
    expect(developer?.items.map((item) => item.tab)).toContain('Connections');
    expect(developer?.items.map((item) => item.tab)).toContain('Harness');
  });
});
