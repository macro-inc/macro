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
import { Harness } from './Harness';

const mocks = vi.hoisted(() => ({
  status: {
    data: {
      registered: false,
      defaultModelId: null as string | null,
      updatedAt: null as string | null,
    },
    isPlaceholderData: false,
  },
  models: {
    data: {
      models: [{ id: 'default-model', displayName: 'Default Model' }],
    },
  },
  save: vi.fn(),
  disconnect: vi.fn(),
  setDefaultModel: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
}));

const harnessMocks = vi.hoisted(() => ({
  query: {
    data: [] as unknown[],
    isError: false,
  },
  deleteHarness: vi.fn(),
  approve: vi.fn(),
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
  searchParams: { pair: undefined as string | undefined },
  setSearchParams: vi.fn(),
}));

vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => mocks.status,
  useSaveCursorApiKey: () => ({
    mutateAsync: mocks.save,
    isPending: false,
  }),
  useDisconnectCursorApiKey: () => ({
    mutateAsync: mocks.disconnect,
    isPending: false,
  }),
  useCursorModelsQuery: () => mocks.models,
  useSetCursorDefaultModel: () => ({
    mutateAsync: mocks.setDefaultModel,
    isPending: false,
  }),
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => harnessMocks.query,
  useDeleteHarnessMutation: () => ({
    mutateAsync: harnessMocks.deleteHarness,
    isPending: false,
  }),
  useHarnessPairingQuery: (code: () => string | undefined) => ({
    get data() {
      return code() && !harnessMocks.pairing.isError
        ? harnessMocks.pairing.data
        : undefined;
    },
    get isError() {
      return Boolean(code()) && harnessMocks.pairing.isError;
    },
    get error() {
      return harnessMocks.pairing.isError ? new Error('gone') : null;
    },
  }),
  useApproveHarnessPairingMutation: () => ({
    mutateAsync: harnessMocks.approve,
    isPending: false,
  }),
  invalidateHarnesses: vi.fn(),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: { team: { id: 'team-1' } } }),
}));

vi.mock('@solidjs/router', () => ({
  useSearchParams: () => [
    harnessMocks.searchParams,
    harnessMocks.setSearchParams,
  ],
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    failure: mocks.toastFailure,
  },
}));

const REGISTERED_HARNESS = {
  id: '3f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e6f',
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'team', team_id: 'team-1' },
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
};

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.data = {
    registered: false,
    defaultModelId: null,
    updatedAt: null,
  };
  mocks.status.isPlaceholderData = false;
  mocks.save.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  harnessMocks.query.data = [];
  harnessMocks.query.isError = false;
  harnessMocks.pairing.isError = false;
  harnessMocks.deleteHarness.mockResolvedValue(undefined);
  harnessMocks.approve.mockResolvedValue(REGISTERED_HARNESS);
  harnessMocks.searchParams.pair = undefined;
});

describe('Harness', () => {
  it('shows the three configurable harness options', () => {
    render(() => <Harness />);

    expect(screen.getByRole('heading', { name: 'In-memory' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cursor' })).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Bring your own agent' })
    ).toBeTruthy();
    expect(screen.getByText(/This is not a coding harness/)).toBeTruthy();
  });

  it('validates and saves a Cursor API key', async () => {
    render(() => <Harness />);

    const apiKeyInput = screen.getByLabelText('API key');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    expect(apiKeyInput).toHaveProperty('type', 'password');
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.input(apiKeyInput, { target: { value: 'not-a-cursor-key' } });
    fireEvent.click(saveButton);

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Cursor API keys start with crsr_'
    );

    fireEvent.input(apiKeyInput, { target: { value: '  crsr_example  ' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('crsr_example');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor connected');
      expect(apiKeyInput).toHaveProperty('value', '');
    });
  });

  it('shows connection status, the default model picker, and disconnect for connected Cursor', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };

    render(() => <Harness />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByText(/does not revoke it in Cursor/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'default-model' },
    });
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith('default-model');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Default model updated');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await waitFor(() => {
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor disconnected');
    });
  });

  it('does not flash the API key form while connection status loads', () => {
    mocks.status.isPlaceholderData = true;

    render(() => <Harness />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('links the empty BYOA list to the setup documentation', () => {
    render(() => <Harness />);

    expect(screen.getByText('No agents connected')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Setup guide/ })).toHaveProperty(
      'href',
      'https://docs.macro.com/AI/bring-your-own'
    );
  });

  it('offers "Enter pairing code" in the header and empty state', () => {
    render(() => <Harness />);

    expect(
      screen.getAllByRole('button', { name: 'Enter pairing code' })
    ).toHaveLength(2);
  });

  it('renders a registered harness row', () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <Harness />);

    expect(screen.getByText('Dev box')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy();
    expect(screen.getByText(/Last connected /)).toBeTruthy();
    expect(screen.queryByText('Never connected')).toBeNull();
  });

  it('shows a disconnected private harness that never connected', () => {
    harnessMocks.query.data = [
      {
        ...REGISTERED_HARNESS,
        owner: { type: 'user', user_id: 'macro|user@example.com' },
        connected: false,
        last_connected_at: null,
      },
    ];

    render(() => <Harness />);

    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeTruthy();
    expect(screen.getByText('Never connected')).toBeTruthy();
  });

  it('confirms before removing a harness', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove Dev box?')).toBeTruthy();
    expect(
      within(dialog).getByText(/Agents using this harness will stop running/)
    ).toBeTruthy();
    expect(harnessMocks.deleteHarness).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove harness' })
    );

    await waitFor(() => {
      expect(harnessMocks.deleteHarness).toHaveBeenCalledWith({
        harnessId: REGISTERED_HARNESS.id,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Harness removed');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens the pairing dialog prefilled from the pair search param', async () => {
    harnessMocks.searchParams.pair = 'KX7M-4QHD';

    render(() => <Harness />);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('KX7M-4QHD')).toBeTruthy();
    expect(within(dialog).getByText('Dev laptop')).toBeTruthy();
    expect(harnessMocks.setSearchParams).toHaveBeenCalledWith(
      { pair: undefined },
      { replace: true }
    );
  });
});
