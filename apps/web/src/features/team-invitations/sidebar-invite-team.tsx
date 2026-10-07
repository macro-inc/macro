import { ViewSidebar } from '@app/components/view-shell';
import { useSettingsState } from '@core/constant/SettingsState';
import UserPlusIcon from '@phosphor/user-plus.svg';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { createSignal, Show } from 'solid-js';
import { InviteTeamDialog } from './invite-team-dialog';

/**
 * The "Invite team" row pinned to the bottom of a view's sidebar. Teammates
 * invite from here directly; people without a team are sent to team setup.
 */
export function SidebarInviteTeam() {
  const { openSettings } = useSettingsState();
  const teamQuery = useCurrentTeamQuery();
  const isTeamAdmin = useIsTeamAdmin();
  const [open, setOpen] = createSignal(false);

  const team = () => (queryReadyGate(teamQuery) ? teamQuery.data : undefined);
  // Members may invite unless an admin turned that off for the team.
  const canInvite = () => {
    const current = team();
    if (!current) return false;
    return isTeamAdmin() || current.team.allow_non_admin_invites;
  };
  const noTeam = () => queryReadyGate(teamQuery) && !teamQuery.data;

  return (
    <Show when={canInvite() || noTeam()}>
      <ViewSidebar.Footer>
        <ViewSidebar.Action
          onClick={() => (canInvite() ? setOpen(true) : openSettings('Team'))}
        >
          <ViewSidebar.Icon>
            <UserPlusIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Invite team</span>
        </ViewSidebar.Action>
        <Show when={team()?.team.id} keyed>
          {(teamId) => (
            <InviteTeamDialog
              open={open()}
              onOpenChange={setOpen}
              teamId={teamId}
            />
          )}
        </Show>
      </ViewSidebar.Footer>
    </Show>
  );
}
