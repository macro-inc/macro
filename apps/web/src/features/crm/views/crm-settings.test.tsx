import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CrmTeamRole } from '../core/team-config';
import { Crm } from './crm-settings';

const DEFAULT_STAGES = [
  { id: 'lead', label: 'Lead' },
  { id: 'demo', label: 'Demo' },
  { id: 'customer', label: 'Customer' },
];

const state = vi.hoisted(() => ({
  role: 'admin' as CrmTeamRole,
  crmEnabled: true,
  canAccess: (): boolean => true,
  accessState: undefined as
    | (() => 'pending' | 'allowed' | 'denied' | 'error')
    | undefined,
  retryAccess: vi.fn(async () => {}),
  customized: false,
  sourceMounted: vi.fn(),
  sourceDisposed: vi.fn(),
  privacyMounted: vi.fn(),
  privacyDisposed: vi.fn(),
  patch: vi.fn(),
  replace: vi.fn(),
  reset: vi.fn(),
  updateConfig: vi.fn(),
  setBlocked: vi.fn(),
  blocked: [] as string[],
}));

vi.mock('./email-privacy', () => ({
  CrmEmailPrivacySettings: (props: {
    renderOverview: (content: JSX.Element) => JSX.Element;
  }) => {
    state.privacyMounted();
    onCleanup(state.privacyDisposed);
    return props.renderOverview(<div>Email contribution settings</div>);
  },
}));
vi.mock('../components/stage-icon', () => ({ CrmStageIcon: () => null }));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    canAccess: () => state.canAccess(),
    accessState: () =>
      state.accessState?.() ?? (state.canAccess() ? 'allowed' : 'denied'),
    retryAccess: state.retryAccess,
    feedback: { success: vi.fn() },
    MemberAccess: () => <p>Who can use CRM</p>,
  }),
}));
vi.mock('./use-crm', () => {
  const canEdit = () => state.role !== 'member';
  const trackSource = (name: string) => {
    state.sourceMounted(name);
    onCleanup(() => state.sourceDisposed(name));
  };
  return {
    useCurrentTeamQuery: () => ({
      data: {
        team: { id: 'team', crm_enabled: state.crmEnabled },
        members: [{ user_id: 'me', role: state.role }],
      },
    }),
    useIsTeamAdmin: () => canEdit,
    usePatchTeamCrmSettingsMutation: () => ({
      mutate: state.patch,
      isPending: false,
    }),
    useCrmPermissions: () => ({
      canEditStages: canEdit,
      permissions: () => ({
        editStages: 'admin',
        moveClosedDeals: 'admin',
        deleteRecords: 'admin',
      }),
    }),
    useTeamCrmConfig: () => {
      trackSource('team settings');
      return {
        config: () => ({ excludePersonalEmails: true }),
        isLoading: () => false,
        isError: () => false,
        update: { mutate: state.updateConfig, isPending: false },
      };
    },
    useBlockedDomains: () => {
      trackSource('blocked domains');
      return {
        domains: () => state.blocked,
        isPending: () => false,
        isError: () => false,
        setBlocked: { mutate: state.setBlocked, isPending: false },
      };
    },
    useQuickAccessCrmCompaniesQuery: () => ({
      companies: () => [],
      query: { isLoading: false },
    }),
    useDealStages: () => {
      trackSource('stages');
      return {
        stages: () => DEFAULT_STAGES,
        isCustomized: () => state.customized,
        isLoading: () => false,
        isError: () => false,
      };
    },
    useReplaceCrmStagesMutation: () => ({
      mutate: state.replace,
      isPending: false,
    }),
    useResetCrmStagesMutation: () => ({
      mutate: state.reset,
      isPending: false,
    }),
  };
});

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  state.role = 'admin';
  state.crmEnabled = true;
  state.canAccess = () => true;
  state.accessState = undefined;
  state.retryAccess.mockClear();
  state.customized = false;
  state.sourceMounted.mockReset();
  state.sourceDisposed.mockReset();
  state.privacyMounted.mockReset();
  state.privacyDisposed.mockReset();
  state.patch.mockReset();
  state.replace.mockReset();
  state.reset.mockReset();
  state.updateConfig.mockReset();
  state.setBlocked.mockReset();
  state.blocked = [];
});

afterEach(cleanup);

it('opens with who can use CRM, above email contribution', () => {
  render(() => <Crm />);

  const access = screen.getByText('Who can use CRM');
  const contribution = screen.getByText('Email contribution settings');
  expect(
    access.compareDocumentPosition(contribution) &
      Node.DOCUMENT_POSITION_FOLLOWING
  ).toBeTruthy();
});

it('does not construct protected settings sources for a denied member', () => {
  state.role = 'member';
  state.canAccess = () => false;
  render(() => <Crm />);

  expect(state.sourceMounted).not.toHaveBeenCalled();
  expect(state.privacyMounted).toHaveBeenCalledOnce();
  expect(screen.getByText('Email contribution settings')).toBeTruthy();
});

it.each(['pending', 'error'] as const)(
  'keeps stage and email sync settings while the access check is %s',
  (access) => {
    state.canAccess = () => false;
    state.accessState = () => access;
    render(() => <Crm />);

    expect(state.sourceMounted.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(['stages', 'team settings', 'blocked domains'])
    );
    expect(screen.getByText('Demo')).toBeTruthy();
  }
);

it('reports a failed access check in a settings row with its retry', () => {
  state.canAccess = () => false;
  state.accessState = () => 'error';
  render(() => <Crm />);

  expect(screen.getByRole('alert').textContent).toBe(
    "Couldn't check your CRM access."
  );
  // The list views' full-pane empty state would push the settings off screen.
  expect(
    screen.queryByText('Please try again to reload this view.')
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(state.retryAccess).toHaveBeenCalledOnce();
});

it.each(['pending', 'allowed', 'denied'] as const)(
  'shows no access failure while the check is %s',
  (access) => {
    state.canAccess = () => access === 'allowed';
    state.accessState = () => access;
    render(() => <Crm />);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  }
);

it('disposes protected settings sources on revocation and keeps contribution mounted', () => {
  state.role = 'member';
  const [allowed, setAllowed] = createSignal(true);
  state.canAccess = allowed;
  render(() => <Crm />);
  const contribution = screen.getByText('Email contribution settings');
  const mounted = state.sourceMounted.mock.calls.map(([name]) => name);
  expect(mounted).toEqual(
    expect.arrayContaining(['stages', 'team settings', 'blocked domains'])
  );
  expect(state.sourceDisposed).not.toHaveBeenCalled();

  setAllowed(false);

  expect(state.sourceDisposed.mock.calls.map(([name]) => name).sort()).toEqual(
    [...mounted].sort()
  );
  expect(state.sourceMounted).toHaveBeenCalledTimes(mounted.length);
  expect(screen.queryByText('Demo')).toBeNull();
  expect(
    screen.queryByRole('switch', { name: 'Keep personal emails out' })
  ).toBeNull();
  expect(screen.getByText('Email contribution settings')).toBe(contribution);
  expect(state.privacyDisposed).not.toHaveBeenCalled();

  setAllowed(true);

  expect(state.sourceMounted).toHaveBeenCalledTimes(mounted.length * 2);
  expect(screen.getByText('Demo')).toBeTruthy();
  expect(state.privacyMounted).toHaveBeenCalledOnce();
  expect(state.privacyDisposed).not.toHaveBeenCalled();
});

it('keeps records and stage settings available without legacy team enablement', () => {
  state.crmEnabled = false;
  render(() => <Crm />);
  expect(screen.getByText('Email contribution settings')).toBeTruthy();
  expect(screen.getByText('Demo')).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Team CRM' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Disable CRM' })).toBeNull();
  expect(state.patch).not.toHaveBeenCalled();
});

it('shows members the stages without letting them change anything', () => {
  state.role = 'member';
  render(() => <Crm />);

  expect(screen.getByText(/Only team admins can change them/)).toBeTruthy();
  expect(screen.getByText('Demo')).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
  expect(screen.queryByText('Closed stages')).toBeNull();
});

it('copies the default stages when an admin customizes them', () => {
  render(() => <Crm />);

  fireEvent.click(screen.getByRole('button', { name: 'Customize' }));

  expect(state.replace).toHaveBeenCalledWith(
    [{ label: 'Lead' }, { label: 'Demo' }, { label: 'Customer' }],
    expect.anything()
  );
});

it('renames and deletes customized stages', async () => {
  state.customized = true;
  render(() => <Crm />);

  const demo = screen.getByRole('textbox', { name: 'Rename Demo' });
  fireEvent.input(demo, { target: { value: 'Discovery' } });
  fireEvent.keyDown(demo, { key: 'Enter' });
  expect(state.replace).toHaveBeenLastCalledWith(
    [
      { id: 'lead', label: 'Lead' },
      { id: 'demo', label: 'Discovery' },
      { id: 'customer', label: 'Customer' },
    ],
    expect.anything()
  );

  fireEvent.click(screen.getByRole('button', { name: 'Delete Customer' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
  expect(state.replace).toHaveBeenLastCalledWith(
    [
      { id: 'lead', label: 'Lead' },
      { id: 'demo', label: 'Demo' },
    ],
    expect.anything()
  );
});

it('lets an admin let personal emails in and block a domain', () => {
  state.blocked = ['spam.com'];
  render(() => <Crm />);

  fireEvent.click(
    screen.getByRole('switch', { name: 'Keep personal emails out' })
  );
  expect(state.updateConfig).toHaveBeenCalledWith({
    excludePersonalEmails: false,
  });

  const input = screen.getByRole('textbox', { name: 'Domain to block' });
  fireEvent.input(input, { target: { value: ' Acme.com ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Block' }));
  expect(state.setBlocked).toHaveBeenCalledWith(
    { domain: 'acme.com', blocked: true },
    expect.anything()
  );

  fireEvent.click(screen.getByRole('button', { name: 'Unblock spam.com' }));
  expect(state.setBlocked).toHaveBeenCalledWith(
    { domain: 'spam.com', blocked: false },
    expect.anything()
  );
});

it('shows members the email sync settings without letting them change them', () => {
  state.role = 'member';
  state.blocked = ['spam.com'];
  render(() => <Crm />);

  expect(
    screen.getByRole('switch', { name: 'Keep personal emails out' })
  ).toHaveProperty('disabled', true);
  screen.getByText('spam.com');
  expect(screen.queryByRole('textbox', { name: 'Domain to block' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Unblock spam.com' })).toBeNull();
});
