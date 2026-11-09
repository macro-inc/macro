import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import UserPlusIcon from '@icon/system/regular/user-plus.svg';
import UsersThreeIcon from '@icon/system/regular/users-three.svg';
import { useTeamQuery, useUserTeamsQuery } from '@queries/team/teams';
import { pressHandlers } from '@ui';
import {
  type Component,
  type ComponentProps,
  createSignal,
  createUniqueId,
  type JSX,
  Show,
} from 'solid-js';
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
        icon={UsersThreeIcon}
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
        icon={UserPlusIcon}
        label={t('settingsNav.inviteTeam')}
        gradient
        onPress={() => setOpen(true)}
      />
      <InviteToTeamDialog
        teamId={props.teamId}
        canManageLink={isTeamAdminOrOwner(role())}
        canInviteAgents={isTeamAdminOrOwner(role())}
        open={open()}
        onClose={() => setOpen(false)}
      />
    </Show>
  );
}

type SvgIcon = Component<ComponentProps<'svg'>>;

function ActionItem(props: {
  icon: SvgIcon;
  label: string;
  /** Paint the icon and label in a soft gradient to draw the eye. */
  gradient?: boolean;
  onPress: () => void;
}) {
  const gradientId = createUniqueId();
  return (
    <ViewSidebar.Item {...pressHandlers(() => props.onPress())}>
      <ViewSidebar.Icon>
        <Show when={props.gradient} fallback={<props.icon class="size-4" />}>
          {/* Inline size: ViewSidebar.Icon sizes every child svg. */}
          <svg
            aria-hidden="true"
            style={{ position: 'absolute', width: '0', height: '0' }}
          >
            <defs>
              {/* Icons use a 24×24 viewBox; userSpaceOnUse keeps one sweep
                  across every path instead of one per path. Stops go in
                  style because presentation attributes can't resolve var(). */}
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1="0"
                y1="0"
                x2="24"
                y2="0"
              >
                <stop offset="0" style={{ 'stop-color': GRADIENT_STOPS[0] }} />
                <stop offset="1" style={{ 'stop-color': GRADIENT_STOPS[1] }} />
              </linearGradient>
            </defs>
          </svg>
          <props.icon
            class="size-4"
            style={{ stroke: `url(#${gradientId})` }}
          />
        </Show>
      </ViewSidebar.Icon>
      <span
        class="truncate font-medium"
        style={props.gradient ? GRADIENT_TEXT_STYLE : undefined}
      >
        {props.label}
      </span>
    </ViewSidebar.Item>
  );
}

/**
 * A restrained pink → violet → indigo sweep. The icon carries the first leg
 * and the label picks up from there, so the two read as one gradient. Each hue
 * is pulled 40% toward the ink color, which mutes it and keeps the small label
 * at 4.5:1 or better on both the light and dark sidebars.
 */
const GRADIENT_STOPS = ['#d6409f', '#8e4ec6', '#3e63dd'].map(
  (hue) => `color-mix(in oklch, ${hue} 60%, var(--color-ink))`
);

const GRADIENT_TEXT_STYLE: JSX.CSSProperties = {
  'background-image': `linear-gradient(90deg, ${GRADIENT_STOPS.slice(1).join(', ')})`,
  'background-clip': 'text',
  '-webkit-background-clip': 'text',
  color: 'transparent',
};
