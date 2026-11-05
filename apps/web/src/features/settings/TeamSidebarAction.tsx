import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team/teams';
import { pressHandlers } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { CreateTeamDialog, InviteToTeamDialog } from './Team';
import { canInviteToTeam, isTeamAdminOrOwner } from './teamMemberPermissions';

/**
 * The settings sidebar's top action: invite people to your team, or create a
 * team when you don't have one yet.
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
      <ActionItem
        icon={<UsersThreeIcon class="size-4" />}
        label={t('settingsNav.createTeam')}
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
  const role = () => {
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    return team?.members.find((member) => member.user_id === userId())?.role;
  };
  const canInvite = () => {
    const team = teamQuery.isSuccess ? teamQuery.data : undefined;
    if (!team) return false;
    return canInviteToTeam(role(), team.team.allow_non_admin_invites);
  };

  return (
    <Show when={canInvite()}>
      <ActionItem
        icon={<UserPlusIcon class="size-4" />}
        label={t('settingsNav.inviteTeam')}
        rainbow
        onPress={() => setOpen(true)}
      />
      <InviteToTeamDialog
        teamId={props.teamId}
        canManageLink={isTeamAdminOrOwner(role())}
        open={open()}
        onClose={() => setOpen(false)}
      />
    </Show>
  );
}

function ActionItem(props: {
  icon: JSX.Element;
  label: string;
  /** Paint the label in a rainbow gradient to draw the eye. */
  rainbow?: boolean;
  onPress: () => void;
}) {
  return (
    <ViewSidebar.Item {...pressHandlers(() => props.onPress())}>
      <ViewSidebar.Icon>{props.icon}</ViewSidebar.Icon>
      <span
        class="truncate font-medium"
        style={props.rainbow ? RAINBOW_TEXT_STYLE : undefined}
      >
        {props.label}
      </span>
    </ViewSidebar.Item>
  );
}

/**
 * Rainbow stops pulled toward the ink color: darker on the light sidebar and
 * lighter on the dark one, so every part of the small label stays legible.
 */
const RAINBOW_TEXT_STYLE: JSX.CSSProperties = {
  'background-image': `linear-gradient(90deg, ${[
    '#e5484d',
    '#f5a524',
    '#30a46c',
    '#0091ff',
    '#8e4ec6',
    '#d6409f',
  ]
    .map((hue) => `color-mix(in oklch, ${hue} 70%, var(--color-ink))`)
    .join(', ')})`,
  'background-clip': 'text',
  '-webkit-background-clip': 'text',
  color: 'transparent',
};
