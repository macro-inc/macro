import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
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
  customized: false,
  patch: vi.fn(),
  replace: vi.fn(),
  reset: vi.fn(),
}));

vi.mock('../components/stage-icon', () => ({ CrmStageIcon: () => null }));
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({ feedback: { success: vi.fn() } }),
}));
vi.mock('./use-crm', () => {
  const canEdit = () => state.role !== 'member';
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
    useTeamCrmConfig: () => ({
      isLoading: () => false,
      isError: () => false,
    }),
    useDealStages: () => ({
      stages: () => DEFAULT_STAGES,
      isCustomized: () => state.customized,
      isLoading: () => false,
      isError: () => false,
    }),
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
  state.customized = false;
  state.patch.mockReset();
  state.replace.mockReset();
  state.reset.mockReset();
});

afterEach(cleanup);

function teamCrmSwitch() {
  return screen.getByRole('switch', { name: 'Team CRM' });
}

it('asks an admin how to start the CRM before turning it on', async () => {
  state.crmEnabled = false;
  render(() => <Crm />);

  fireEvent.click(teamCrmSwitch());
  fireEvent.click(
    await screen.findByRole('button', { name: 'Backfill existing emails' })
  );

  expect(state.patch).toHaveBeenCalledWith(
    { enabled: true, backfill: true },
    expect.anything()
  );
  expect(screen.queryByText('Stages')).toBeNull();
});

it('turns the CRM off only after the phrase is typed', async () => {
  render(() => <Crm />);

  fireEvent.click(teamCrmSwitch());
  const confirm = await screen.findByRole('button', { name: 'Disable CRM' });
  expect(confirm).toHaveProperty('disabled', true);

  fireEvent.input(screen.getByPlaceholderText('Disable CRM'), {
    target: { value: 'Disable CRM' },
  });
  fireEvent.click(confirm);

  expect(state.patch).toHaveBeenCalledWith(
    { enabled: false, backfill: false },
    expect.anything()
  );
});

it('shows members the stages without letting them change anything', () => {
  state.role = 'member';
  render(() => <Crm />);

  expect(teamCrmSwitch()).toHaveProperty('disabled', true);
  expect(
    screen.getByText(/Only team admins can turn it on or off/)
  ).toBeTruthy();
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
