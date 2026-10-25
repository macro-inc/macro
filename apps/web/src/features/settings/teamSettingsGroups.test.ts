import { SETTINGS_TAB_GROUPS } from '@core/constant/settingsTabsConfig';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTeamSettingsGroups } from './teamSettingsGroups';

const [teamsQuery, setTeamsQuery] = createStore<{
  isSuccess: boolean;
  data: { name: string }[] | undefined;
}>({ isSuccess: false, data: undefined });

vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => teamsQuery,
}));

let dispose: () => void;
afterEach(() => dispose?.());

const teamGroup = () =>
  createRoot((cleanup) => {
    dispose = cleanup;
    const groups = useTeamSettingsGroups(() => SETTINGS_TAB_GROUPS);
    return () => groups()[0];
  });

describe('team settings group', () => {
  it('names the group after the team and lists every team page', () => {
    setTeamsQuery({ isSuccess: true, data: [{ name: 'Macro' }] });
    const group = teamGroup();
    expect(group().label).toBe('Team · Macro');
    expect(group().items.map((item) => item.label)).toEqual([
      'General',
      'Members',
      'Connections',
    ]);
  });

  it('keeps only the create-team page without a team', () => {
    setTeamsQuery({ isSuccess: true, data: [] });
    const group = teamGroup();
    expect(group().label).toBe('Team');
    expect(group().items.map((item) => item.tab)).toEqual(['Team']);
  });

  it('keeps every page while teams load', () => {
    setTeamsQuery({ isSuccess: false, data: undefined });
    const group = teamGroup();
    expect(group().label).toBe('Team');
    expect(group().items).toHaveLength(3);
    setTeamsQuery({ isSuccess: true, data: [{ name: 'Acme' }] });
    expect(group().label).toBe('Team · Acme');
  });
});
