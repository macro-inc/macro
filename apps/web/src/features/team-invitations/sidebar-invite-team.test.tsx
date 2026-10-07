import { fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { SidebarInviteTeam } from './sidebar-invite-team';

const host = vi.hoisted(() => ({
  team: undefined as
    | { team: { id: string; allow_non_admin_invites: boolean } }
    | null
    | undefined,
  isAdmin: false,
  openSettings: vi.fn(),
}));

vi.mock('@app/components/view-shell', () => ({
  ViewSidebar: {
    Footer: (props: ParentProps) => <div>{props.children}</div>,
    Action: (props: ParentProps<{ onClick: () => void }>) => (
      <button type="button" onClick={props.onClick}>
        {props.children}
      </button>
    ),
    Icon: (props: ParentProps) => <span>{props.children}</span>,
  },
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ openSettings: host.openSettings }),
}));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    get isPending() {
      return host.team === undefined;
    },
    get data() {
      return host.team;
    },
  }),
  useIsTeamAdmin: () => () => host.isAdmin,
}));
vi.mock('./invite-team-dialog', () => ({
  InviteTeamDialog: (props: { open: boolean; teamId: string }) => (
    <div hidden={!props.open}>Invite dialog for {props.teamId}</div>
  ),
}));

beforeEach(() => {
  host.team = undefined;
  host.isAdmin = false;
  host.openSettings.mockClear();
});

it('lets a member open the invite dialog while members may invite', () => {
  host.team = { team: { id: 'team-1', allow_non_admin_invites: true } };
  render(() => <SidebarInviteTeam />);

  expect(screen.getByText('Invite dialog for team-1').hidden).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Invite team' }));

  expect(screen.getByText('Invite dialog for team-1').hidden).toBe(false);
  expect(host.openSettings).not.toHaveBeenCalled();
});

it('hides the row from a member once an admin turns member invites off', () => {
  host.team = { team: { id: 'team-1', allow_non_admin_invites: false } };
  render(() => <SidebarInviteTeam />);

  expect(screen.queryByRole('button', { name: 'Invite team' })).toBeNull();
});

it('keeps the row for admins when member invites are off', () => {
  host.team = { team: { id: 'team-1', allow_non_admin_invites: false } };
  host.isAdmin = true;
  render(() => <SidebarInviteTeam />);

  expect(screen.queryByRole('button', { name: 'Invite team' })).not.toBeNull();
});

it('sends people without a team to team setup', () => {
  host.team = null;
  render(() => <SidebarInviteTeam />);

  fireEvent.click(screen.getByRole('button', { name: 'Invite team' }));

  expect(host.openSettings).toHaveBeenCalledWith('Team');
});

it('shows nothing while the team is still loading', () => {
  render(() => <SidebarInviteTeam />);

  expect(screen.queryByRole('button', { name: 'Invite team' })).toBeNull();
});
