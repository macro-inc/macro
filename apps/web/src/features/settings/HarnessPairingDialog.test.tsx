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
import { HarnessPairingDialog } from './HarnessPairingDialog';

const mocks = vi.hoisted(() => ({
  pairing: {
    data: {
      code: 'KX7M-4QHD',
      requested_name: 'Dev laptop',
      requested_scope: null,
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
  useCurrentTeamQuery: () => ({ data: mocks.currentTeam }),
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
  mocks.approve.mockResolvedValue({ id: 'harness-1' });
  mocks.currentTeam = { team: { id: 'team-1' } };
});

describe('HarnessPairingDialog', () => {
  it('looks up a typed code and shows the pairing request', () => {
    render(() => <HarnessPairingDialog onClose={() => {}} />);

    const dialog = screen.getByRole('dialog');
    const codeInput = within(dialog).getByLabelText('Pairing code');
    fireEvent.input(codeInput, { target: { value: 'kx7m-4qhd' } });
    expect(codeInput).toHaveProperty('value', 'KX7M-4QHD');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Look up' }));

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
      <HarnessPairingDialog initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('dialog');
    fireEvent.input(within(dialog).getByLabelText('Name'), {
      target: { value: 'Home desktop' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(mocks.approve).toHaveBeenCalledWith({
        code: 'KX7M-4QHD',
        name: 'Home desktop',
        teamId: undefined,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Harness connected');
    });
  });

  it('approves a team harness with the current team id', async () => {
    render(() => (
      <HarnessPairingDialog initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByLabelText('Team'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(mocks.approve).toHaveBeenCalledWith({
        code: 'KX7M-4QHD',
        name: 'Dev laptop',
        teamId: 'team-1',
      });
    });
  });

  it('disables the Team choice without a team', () => {
    mocks.currentTeam = null;

    render(() => (
      <HarnessPairingDialog initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Team')).toHaveProperty(
      'disabled',
      true
    );
    expect(
      within(dialog).getByText(
        'Create or join a team before sharing harnesses.'
      )
    ).toBeTruthy();
  });

  it('shows the invalid-code copy when the lookup fails', () => {
    mocks.pairing.isError = true;

    render(() => (
      <HarnessPairingDialog initialCode="KX7M-4QHD" onClose={() => {}} />
    ));

    const dialog = screen.getByRole('dialog');
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
      <HarnessPairingDialog initialCode="KX7M-4QHD" onClose={onClose} />
    ));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(
        within(dialog).getByText(
          'Harness connected. macrod will finish pairing automatically.'
        )
      ).toBeTruthy();
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
