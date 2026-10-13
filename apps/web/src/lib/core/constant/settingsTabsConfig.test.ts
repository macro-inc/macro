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
  it('gives calendar connections and booking links separate routes', () => {
    expect(settingsSlugToTab('calendar')).toBe('Calendar');
    expect(settingsSlugToTab('booking-links')).toBe('Booking links');
    expect(settingsTabToSlug('Booking links')).toBe('booking-links');
  });
  it('routes calls settings to their own page', () => {
    expect(settingsSlugToTab('calls')).toBe('Calls');
    expect(settingsTabToSlug('Calls')).toBe('calls');
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
      'Calls',
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
