import {
  type SettingsTabGroup,
  TEAM_SETTINGS_GROUP_LABEL,
} from '@core/constant/settingsTabsConfig';
import { useUserTeamsQuery } from '@queries/team/teams';
import { type Accessor, createMemo } from 'solid-js';

/**
 * Names the settings nav's team group after the viewer's team
 * (`Team · Macro`). Without a team only General stays, where the create-team
 * prompt and pending invitations live.
 */
export function useTeamSettingsGroups(groups: Accessor<SettingsTabGroup[]>) {
  const userTeamsQuery = useUserTeamsQuery();
  return createMemo(() => {
    // Keep every page while teams load so the nav doesn't jump.
    const teams = userTeamsQuery.isSuccess ? userTeamsQuery.data : undefined;
    return groups().map((group) => {
      if (group.label !== TEAM_SETTINGS_GROUP_LABEL || !teams) return group;
      const team = teams[0];
      return team
        ? { ...group, label: `${group.label} · ${team.name}` }
        : {
            ...group,
            items: group.items.filter((item) => item.tab === 'Team'),
          };
    });
  });
}
