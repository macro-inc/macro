import { describe, expect, it } from 'vitest';
import {
  SETTINGS_TAB_GROUPS,
  settingsSlugToTab,
  settingsTabToSlug,
} from './settingsTabsConfig';

describe('settings Usage tab', () => {
  it('routes Usage and places it directly before Billing', () => {
    expect(settingsSlugToTab('usage')).toBe('Usage');
    expect(settingsTabToSlug('Usage')).toBe('usage');
    const tabs = SETTINGS_TAB_GROUPS.flatMap((group) =>
      group.items.map((item) => item.tab)
    );
    expect(tabs[tabs.indexOf('Billing') - 1]).toBe('Usage');
  });
});

describe('settings navigation', () => {
  it('keeps calendar connections in settings and removes booking links settings', () => {
    expect(settingsSlugToTab('calendar')).toBe('Calendar');
    expect(settingsSlugToTab('booking-links')).toBeUndefined();
  });
  it('routes old agent-connections links to Integrations', () => {
    expect(settingsSlugToTab('agent-connections')).toBe('Connected');
  });

  it('keeps the connections slug on Integrations', () => {
    expect(settingsSlugToTab('connections')).toBe('Connected');
  });

  it('puts team settings first, with members on their own page', () => {
    expect(SETTINGS_TAB_GROUPS[0].label).toBe('Team');
    expect(SETTINGS_TAB_GROUPS[0].items.map((item) => item.tab)).toEqual([
      'Team',
      'Team Members',
    ]);
    // Old team links keep opening the team's general page.
    expect(settingsSlugToTab('team')).toBe('Team');
    expect(settingsSlugToTab('team-members')).toBe('Team Members');
    // Team connections moved into Integrations.
    expect(settingsSlugToTab('team-connections')).toBe('Connected');
  });

  it('groups blocks after the team and consolidates account and agent integrations', () => {
    expect(SETTINGS_TAB_GROUPS[1].label).toBe('Blocks');
    expect(SETTINGS_TAB_GROUPS[1].items.map((item) => item.tab)).toEqual([
      'Email',
      'Calendar',
      'Agents',
      'Routines',
      'CRM',
    ]);
    const workspace = SETTINGS_TAB_GROUPS.find(
      (group) => group.label === 'Workspace'
    );
    const developer = SETTINGS_TAB_GROUPS.find(
      (group) => group.label === 'Developer'
    );
    expect(workspace?.items.map((item) => item.tab)).toContain('Connected');
    expect(
      SETTINGS_TAB_GROUPS.flatMap((group) => group.items).map(
        (item) => item.tab
      )
    ).not.toContain('Connections');
    expect(developer?.items.map((item) => item.tab)).toContain('Harness');
  });
});
