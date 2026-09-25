/**
 * @vitest-environment jsdom
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RuntimePairingPage } from './RuntimePairingPage';

const mocks = vi.hoisted(() => ({
  pairing: {
    data: {
      code: 'KX7M-4QHD',
      requested_name: 'Dev laptop',
      requested_scope: null,
      requested_allow_permission_bypass: null as boolean | null,
      host: 'erics-mbp.local',
      created_at: '2026-08-27T12:00:00Z',
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    },
    isError: false,
  },
  approve: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
  currentTeam: { team: { id: 'team-1' } } as { team: { id: string } } | null,
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessPairingQuery: (code: () => string | undefined) => ({
    get data() {
      return code() && !mocks.pairing.isError ? mocks.pairing.data : undefined;
    },
    get isError() {
      return Boolean(code()) && mocks.pairing.isError;
    },
    get isSuccess() {
      return Boolean(code()) && !mocks.pairing.isError;
    },
    get error() {
      return mocks.pairing.isError ? new Error('gone') : null;
    },
  }),
  useApproveHarnessPairingMutation: () => ({
    mutateAsync: mocks.approve,
    isPending: false,
  }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ isSuccess: true, data: mocks.currentTeam }),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    failure: mocks.toastFailure,
  },
}));

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pairing.isError = false;
  mocks.pairing.data.requested_allow_permission_bypass = null;
  mocks.approve.mockResolvedValue({ id: 'harness-1' });
  mocks.currentTeam = { team: { id: 'team-1' } };
});

describe('RuntimePairingPage', () => {
  it('looks up a typed code and shows the pairing request', () => {
    render(() => <RuntimePairingPage onClose={() => {}} />);

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    const codeInput = within(dialog).getByLabelText('Pairing code');
    expect(codeInput).toHaveProperty('value', '');
    expect(
      screen.queryByRole('img', { name: /Example macrod terminal/ })
    ).toBeNull();
    fireEvent.input(codeInput, { target: { value: 'kx7m-4qhd' } });
    expect(codeInput).toHaveProperty('value', 'KX7M-4QHD');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Look up' }));
    expect(
      screen.queryByRole('list', { name: 'Runtime setup steps' })
    ).toBeNull();
    expect(within(dialog).getByText('KX7M-4QHD')).toBeTruthy();
    expect(
      within(dialog).getByText(/Confirm this matches the code macrod printed/)
    ).toBeTruthy();
    expect(within(dialog).getByText('Dev laptop')).toBeTruthy();
    expect(within(dialog).getByText('erics-mbp.local')).toBeTruthy();
    expect(within(dialog).getByText(/Expires in \d+ minutes/)).toBeTruthy();
    expect(within(dialog).getByLabelText('Name')).toHaveProperty(
      'value',
      'Dev laptop'
    );
  });

  it('approves a private harness without a team id', async () => {
    render(() => (
      <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Home desktop' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(mocks.approve).toHaveBeenCalledWith({
        code: 'KX7M-4QHD',
        name: 'Home desktop',
        allowPermissionBypass: false,
        teamId: undefined,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Runtime connected');
    });
  });

  it('approves a team harness with the current team id', async () => {
    render(() => (
      <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    fireEvent.click(within(dialog).getByLabelText('Team'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(mocks.approve).toHaveBeenCalledWith({
        code: 'KX7M-4QHD',
        name: 'Dev laptop',
        allowPermissionBypass: false,
        teamId: 'team-1',
      });
    });
  });

  it('disables the Team choice without a team', () => {
    mocks.currentTeam = null;

    render(() => (
      <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    expect(within(dialog).getByLabelText('Team')).toHaveProperty(
      'disabled',
      true
    );
    expect(
      within(dialog).getByText('Create or join a team before sharing runtimes.')
    ).toBeTruthy();
  });

  it('shows the invalid-code copy when the lookup fails', () => {
    mocks.pairing.isError = true;

    render(() => (
      <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    expect(
      within(dialog).getByText(
        'This pairing code is invalid, expired, or already claimed.'
      )
    ).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Try another code' })
    );
    expect(within(dialog).getByLabelText('Pairing code')).toBeTruthy();
  });

  it('shows the success phase after approving', async () => {
    const onClose = vi.fn();
    render(() => (
      <RuntimePairingPage initialCode="KX7M-4QHD" onClose={onClose} />
    ));

    const dialog = screen.getByRole('region', { name: 'New runtime' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(
        within(dialog).getByText(
          'Runtime connected. macrod will finish pairing automatically.'
        )
      ).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

it('warns before opting a harness into permission bypass', async () => {
  render(() => (
    <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
  ));
  const dialog = screen.getByRole('region', { name: 'New runtime' });
  const toggle = within(dialog).getByRole('checkbox');
  expect(toggle).toHaveProperty('checked', false);
  fireEvent.click(toggle);
  expect(within(dialog).getByRole('alert').textContent).toContain(
    'without approval'
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
  await waitFor(() =>
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ allowPermissionBypass: true })
    )
  );
});

it('preselects daemon bypass consent and lets the approving user decline it', async () => {
  mocks.pairing.data.requested_allow_permission_bypass = true;
  render(() => (
    <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
  ));
  const checkbox = screen.getByRole('checkbox', {
    name: 'Allow bypassing permission requests',
  });
  expect(checkbox).toHaveProperty('checked', true);
  expect(screen.getByRole('alert').textContent).toContain('without approval');
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() =>
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ allowPermissionBypass: false })
    )
  );
});

it('prevents approval from overriding the daemon prompt-only choice', async () => {
  mocks.pairing.data.requested_allow_permission_bypass = false;
  render(() => (
    <RuntimePairingPage initialCode="KX7M-4QHD" onClose={() => {}} />
  ));
  const checkbox = screen.getByRole('checkbox', {
    name: 'Allow bypassing permission requests',
  });
  expect(checkbox).toHaveProperty('checked', false);
  expect(
    checkbox.hasAttribute('disabled') ||
      checkbox.getAttribute('aria-disabled') === 'true'
  ).toBe(true);
  expect(
    screen.getByText(/This daemon requires permission prompts/)
  ).toBeTruthy();
  fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() =>
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ allowPermissionBypass: false })
    )
  );
});
