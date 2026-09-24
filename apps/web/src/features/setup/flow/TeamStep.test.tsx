import { cleanup, fireEvent, render, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamStep } from './TeamStep';

const wiring = vi.hoisted(() => ({
  teamPending: false,
  teamError: false,
  onTeam: false,
  hasInvite: false,
  contactsPending: false,
  contactsError: false,
  contacts: [] as { email: string }[],
  createError: false,
  create: vi.fn(),
  join: vi.fn(),
  refetch: vi.fn(),
  track: vi.fn(),
  joined: undefined as (() => void) | undefined,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: wiring.track }),
}));
vi.mock('@core/context/user', () => ({ useEmail: () => () => 'me@macro.com' }));
vi.mock('@core/user/util', () => ({ idToDisplayName: () => 'Ada' }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  Layer: (props: { children?: JSX.Element }) => props.children,
}));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => ({
    get isSuccess() {
      return !wiring.teamPending && !wiring.teamError;
    },
    get isPending() {
      return wiring.teamPending;
    },
    get isError() {
      return wiring.teamError;
    },
    get data() {
      if (wiring.teamPending || wiring.teamError)
        throw new Error('Unsettled data read');
      return wiring.onTeam ? [{ name: 'Macro' }] : [];
    },
    refetch: wiring.refetch,
  }),
  useCreateTeamWithInvitesMutation: () => ({
    isPending: false,
    get isError() {
      return wiring.createError;
    },
    mutateAsync: wiring.create,
  }),
}));
vi.mock('@queries/team/invitations', () => ({
  useUserInvitesQuery: () => ({
    isSuccess: true,
    isPending: false,
    isError: false,
    data: {
      invites: wiring.hasInvite
        ? [{ id: 'inv-1', email: 'me@macro.com', invited_by: 'ada' }]
        : [],
    },
    refetch: wiring.refetch,
  }),
  useJoinTeamMutation: (callbacks: { onSuccess: () => void }) => {
    wiring.joined = callbacks.onSuccess;
    return { isPending: false, isError: false, mutate: wiring.join };
  },
}));
vi.mock('@queries/contacts/contacts', () => ({
  useContacts: () => () => (wiring.contactsError ? [] : wiring.contacts),
  useContactsQuery: () => ({
    get isPending() {
      return wiring.contactsPending;
    },
  }),
}));
vi.mock('@queries/onboarding', () => ({
  useOnboardingQuery: () => ({
    isSuccess: true,
    isPending: false,
    isPlaceholderData: false,
    data: { suggested_team_domain: 'macro.com' },
  }),
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  Object.assign(wiring, {
    teamPending: false,
    teamError: false,
    onTeam: false,
    hasInvite: false,
    contactsPending: false,
    contactsError: false,
    contacts: [{ email: 'ada@macro.com' }, { email: 'grace@other.com' }],
    createError: false,
    joined: undefined,
  });
  wiring.create.mockResolvedValue({ id: 'team-1' });
});
afterEach(cleanup);

describe('Team setup', () => {
  it('shows a usable loading state without reading pending team data', () => {
    wiring.teamPending = true;
    const view = render(() => <TeamStep onContinue={vi.fn()} />);
    expect(view.getByRole('status').textContent).toContain(
      'Getting your team ready'
    );
    expect(
      view.queryByRole('button', { name: 'Continue on my own' })
    ).toBeNull();
  });

  it('offers retry rather than a create form when membership cannot be checked', () => {
    wiring.teamError = true;
    const view = render(() => <TeamStep onContinue={vi.fn()} />);
    expect(view.getByRole('alert').textContent).toContain(
      'couldn’t load your team'
    );
    expect(view.queryByLabelText('Workspace name')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Try again' }));
    expect(wiring.refetch).toHaveBeenCalledTimes(2);
  });

  it('keeps existing team members out of team creation', () => {
    wiring.onTeam = true;
    const next = vi.fn();
    const view = render(() => <TeamStep onContinue={next} />);
    expect(view.getByText("You're on Macro")).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Continue' }));
    expect(next).toHaveBeenCalledOnce();
    expect(wiring.create).not.toHaveBeenCalled();
  });

  it('accepts a specific invitation and advances only after success', () => {
    wiring.hasInvite = true;
    const next = vi.fn();
    const view = render(() => <TeamStep onContinue={next} />);
    fireEvent.click(view.getByRole('button', { name: 'Join team' }));
    expect(wiring.join).toHaveBeenCalledWith({ teamInviteId: 'inv-1' });
    expect(next).not.toHaveBeenCalled();
    wiring.joined?.();
    expect(next).toHaveBeenCalledOnce();
  });

  it('shows contact loading then lets a failed contact lookup use the plain form', () => {
    wiring.contactsPending = true;
    const loading = render(() => <TeamStep onContinue={vi.fn()} />);
    expect(loading.getByRole('status')).toBeTruthy();
    loading.unmount();
    wiring.contactsPending = false;
    wiring.contactsError = true;
    const view = render(() => <TeamStep onContinue={vi.fn()} />);
    expect(view.getByLabelText('Workspace name')).toBeTruthy();
    expect(
      (view.getByLabelText('Teammate 1 email') as HTMLInputElement).value
    ).toBe('');
  });

  it('prefills same-domain contacts but sends no invitations before explicit creation', async () => {
    const next = vi.fn();
    const view = render(() => <TeamStep onContinue={next} />);
    expect(
      (view.getByLabelText('Workspace name') as HTMLInputElement).value
    ).toBe('Macro');
    expect(
      (view.getByLabelText('Teammate 1 email') as HTMLInputElement).value
    ).toBe('ada@macro.com');
    expect(wiring.create).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: /Don't invite ada/ }));
    fireEvent.input(view.getByLabelText('Teammate 1 email'), {
      target: { value: 'new@macro.com' },
    });
    fireEvent.click(
      view.getByRole('button', { name: 'Create team & invite 1' })
    );
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(wiring.create).toHaveBeenCalledWith({
      name: 'Macro',
      invites: [{ email: 'new@macro.com' }],
    });
    expect(
      sessionStorage.getItem('onboarding-team-draft:me@macro.com')
    ).toBeNull();
  });

  it('preserves the draft and stays in the form when creation fails', async () => {
    wiring.create.mockRejectedValue(new Error('offline'));
    wiring.createError = true;
    const next = vi.fn();
    const view = render(() => <TeamStep onContinue={next} />);
    fireEvent.input(view.getByLabelText('Workspace name'), {
      target: { value: 'New team' },
    });
    fireEvent.click(
      view.getByRole('button', { name: 'Create team & invite 1' })
    );
    await waitFor(() => expect(wiring.create).toHaveBeenCalledOnce());
    expect(next).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem('onboarding-team-draft:me@macro.com')
    ).toContain('New team');
    expect(view.getByRole('alert').textContent).toContain('details are saved');
  });

  it('prefills teammates and requires removing each recipient before creating without invitations', async () => {
    wiring.contacts = [{ email: 'ada@macro.com' }, { email: 'alan@macro.com' }];
    const next = vi.fn();
    const view = render(() => <TeamStep onContinue={next} />);
    expect(view.queryByRole('checkbox')).toBeNull();
    expect(
      view.queryByRole('button', { name: 'Continue on my own' })
    ).toBeNull();
    expect(
      view.getByRole('button', { name: 'Create team & invite 2' })
    ).toBeTruthy();
    fireEvent.click(
      view.getByRole('button', { name: "Don't invite ada@macro.com" })
    );
    expect(
      view.queryByRole('button', { name: 'Continue on my own' })
    ).toBeNull();
    fireEvent.click(
      view.getByRole('button', { name: "Don't invite alan@macro.com" })
    );
    expect(wiring.create).not.toHaveBeenCalled();
    expect(
      view.queryByRole('button', { name: 'Continue on my own' })
    ).toBeNull();
    view.unmount();

    const restored = render(() => <TeamStep onContinue={next} />);
    expect(restored.queryByRole('button', { name: /Don't invite/ })).toBeNull();
    fireEvent.click(restored.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(wiring.create).toHaveBeenCalledWith({ name: 'Macro', invites: [] });
  });

  it('does not reinstate recipients opted out of in an older saved draft', () => {
    sessionStorage.setItem(
      'onboarding-team-draft:me@macro.com',
      JSON.stringify({
        name: 'Saved workspace',
        inviteTeam: false,
        slots: ['ada@macro.com'],
      })
    );
    const view = render(() => <TeamStep onContinue={vi.fn()} />);
    expect(
      (view.getByLabelText('Workspace name') as HTMLInputElement).value
    ).toBe('Saved workspace');
    expect(view.queryByRole('button', { name: /Don't invite/ })).toBeNull();
    expect(view.getByRole('button', { name: 'Create team' })).toBeTruthy();
  });
});
