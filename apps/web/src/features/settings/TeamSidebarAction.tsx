import { ViewSidebar } from '@app/components/view-shell';
import { useUserId } from '@core/context/user';
import UserPlusIcon from '@phosphor/user-plus.svg';
import UsersThreeIcon from '@phosphor/users-three.svg';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team/teams';
import { pressHandlers } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { CreateTeamDialog, InviteToTeamDialog } from './Team';
import { canInviteToTeam } from './teamMemberPermissions';

/**
 * The settings sidebar's footer action: invite people to your team, or create
 * a team when you don't have one yet.
 */
export function TeamSidebarAction() {
  const userTeamsQuery = useUserTeamsQuery();
  // Wait for the teams so the label doesn't flip from Create to Invite.
  const teams = () =>
    userTeamsQuery.isSuccess ? userTeamsQuery.data : undefined;

  return (
    <Show when={teams()}>
      {(loaded) => (
        <Show when={loaded()[0]} keyed fallback={<CreateTeamAction />}>
          {(team) => <InviteToTeamAction teamId={team.id} />}
        </Show>
      )}
    </Show>
  );
}

function CreateTeamAction() {
  const [open, setOpen] = createSignal(false);
  return (
    <>
      <FooterItem
        icon={<UsersThreeIcon class="size-4" />}
        label="Create a team"
        onPress={() => setOpen(true)}
      />
      <Show when={open()}>
        <CreateTeamDialog open onClose={() => setOpen(false)} />
      </Show>
    </>
  );
}

function InviteToTeamAction(props: { teamId: string }) {
  const userId = useUserId();
  const teamQuery = useTeamQuery(() => props.teamId);
  const [open, setOpen] = createSignal(false);
  const canInvite = () => {
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    if (!team) return false;
    const role = team.members.find(
      (member) => member.user_id === userId()
    )?.role;
    return canInviteToTeam(role, team.team.allow_non_admin_invites);
  };

  return (
    <Show when={canInvite()}>
      <FooterItem
        icon={<UserPlusIcon class="size-4" />}
        label="Invite your team"
        onPress={() => setOpen(true)}
      />
      <InviteToTeamDialog
        teamId={props.teamId}
        open={open()}
        onClose={() => setOpen(false)}
      />
    </Show>
  );
}

function FooterItem(props: {
  icon: JSX.Element;
  label: string;
  onPress: () => void;
}) {
  return (
    <ViewSidebar.Item {...pressHandlers(() => props.onPress())}>
      <ViewSidebar.Icon>{props.icon}</ViewSidebar.Icon>
      <span class="truncate">{props.label}</span>
    </ViewSidebar.Item>
  );
}
