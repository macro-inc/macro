const codexAccess = vi.hoisted(() => ({ enabled: true }));
vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => codexAccess.enabled,
}));

/**
 * @vitest-environment jsdom
 */

import { useAgentModelsQuery } from '@queries/agents/models';
import type { LoadAgentModelsResponse } from '@service-agent-harness/generated/schemas';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/solid-query';
import { Suspense } from 'solid-js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntimes } from './AgentRuntimes';
import { chooseModelOption } from './tests/select-helpers';

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('./codex/views/CodexHarness', () => ({
  CodexHarness: () => <div data-testid="codex-harness" />,
}));

const mocks = vi.hoisted(() => ({
  status: {
    isSuccess: true,
    isError: false,
    data: {
      registered: false,
      defaultModelId: null as string | null,
      updatedAt: null as string | null,
    },
    isPlaceholderData: false,
  },
  models: {
    data: {
      status: 'available' as const,
      currentModel: 'default-model',
      models: [{ id: 'default-model', name: 'Default Model' }],
    },
    isPending: false,
    isError: false,
    isSuccess: true,
    refetch: vi.fn(),
  },
  save: vi.fn(),
  disconnect: vi.fn(),
  setDefaultModel: vi.fn(),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
}));

const harnessMocks = vi.hoisted(() => ({
  query: {
    isSuccess: true,
    isPending: false,
    data: [] as unknown[],
    isError: false,
  },
  deleteHarness: vi.fn(),
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
  useSetCursorDefaultModel: () => ({
    mutateAsync: mocks.setDefaultModel,
    isPending: false,
  }),
}));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: vi.fn(() => mocks.models),
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => harnessMocks.query,
  useDeleteHarnessMutation: () => ({
    mutateAsync: harnessMocks.deleteHarness,
    isPending: false,
  }),
  invalidateHarnesses: vi.fn(),
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
  codexAccess.enabled = true;
  vi.clearAllMocks();
  mocks.status.data = {
    registered: false,
    defaultModelId: null,
    updatedAt: null,
  };
  mocks.status.isPlaceholderData = false;
  mocks.models.data = {
    status: 'available',
    currentModel: 'default-model',
    models: [{ id: 'default-model', name: 'Default Model' }],
  };
  mocks.models.isPending = false;
  mocks.models.isError = false;
  mocks.models.isSuccess = true;
  mocks.save.mockResolvedValue(undefined);
  mocks.disconnect.mockResolvedValue(undefined);
  harnessMocks.query.data = [];
  harnessMocks.query.isError = false;
  harnessMocks.deleteHarness.mockResolvedValue(undefined);
});

describe('AgentRuntimes', () => {
  it.each([false, true])(
    'shows Codex settings only within its rollout (access %s)',
    (enabled) => {
      codexAccess.enabled = enabled;
      render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);
      expect(Boolean(screen.queryByTestId('codex-harness'))).toBe(enabled);
    }
  );

  it.each(['success', 'error'] as const)(
    'keeps settings visible while Cursor models load and after %s',
    async (outcome) => {
      mocks.status.data.registered = true;
      let resolveModels!: (models: LoadAgentModelsResponse) => void;
      let rejectModels!: (error: Error) => void;
      const response = new Promise<LoadAgentModelsResponse>(
        (resolve, reject) => {
          resolveModels = resolve;
          rejectModels = reject;
        }
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      vi.mocked(useAgentModelsQuery).mockImplementationOnce(() =>
        useQuery(() => ({
          queryKey: ['pending-cursor-models'],
          queryFn: () => response,
        }))
      );
      const view = render(() => (
        <QueryClientProvider client={client}>
          <Suspense fallback={<p>Settings suspended</p>}>
            <AgentRuntimes onNewRuntime={vi.fn()} />
          </Suspense>
        </QueryClientProvider>
      ));
      expect(screen.queryByText('Settings suspended')).toBeNull();
      expect(screen.getByText('Loading models…')).toBeTruthy();
      expect(
        (screen.getByLabelText('Default model') as HTMLButtonElement).disabled
      ).toBe(true);

      if (outcome === 'error') {
        rejectModels(new Error('Cursor is unavailable'));
        await waitFor(() =>
          expect(screen.getByText(/Could not load Cursor models/)).toBeTruthy()
        );
        expect(screen.queryByText('Settings suspended')).toBeNull();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
      } else {
        resolveModels({
          status: 'available',
          currentModel: 'loaded-model',
          models: [
            {
              id: 'loaded-model',
              name: 'Loaded Model',
              group: 'Cursor',
            },
          ],
        });
        await waitFor(() =>
          expect(screen.getByText('Loaded Model')).toBeTruthy()
        );
        expect(screen.queryByText('Settings suspended')).toBeNull();
        expect(
          (screen.getByLabelText('Default model') as HTMLButtonElement).disabled
        ).toBe(false);
      }
      view.unmount();
      client.clear();
    }
  );

  it('lists Macro Agent and Cursor in the harness list', () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Macro Agent' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cursor' })).toBeTruthy();
    expect(
      screen.getByText(/Uses official Macro tools and MCPs to get the job done/)
    ).toBeTruthy();
  });

  it('validates and saves a Cursor API key', async () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    const apiKeyInput = screen.getByLabelText('API key');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    expect(apiKeyInput).toHaveProperty('type', 'password');
    expect(saveButton).toHaveProperty('disabled', true);

    fireEvent.input(apiKeyInput, { target: { value: 'not-a-cursor-key' } });
    fireEvent.click(saveButton);

    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.toastFailure).toHaveBeenCalledWith(
      'Cursor API keys start with grok_ or crsr_'
    );

    fireEvent.input(apiKeyInput, { target: { value: '  grok_example  ' } });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('grok_example');
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Cursor connected');
      expect(apiKeyInput).toHaveProperty('value', '');
    });
  });

  it('still accepts a Cursor API key minted with the older crsr_ prefix', async () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    fireEvent.input(screen.getByLabelText('API key'), {
      target: { value: 'crsr_example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mocks.save).toHaveBeenCalledWith('crsr_example');
    });
    expect(mocks.toastFailure).not.toHaveBeenCalled();
  });

  it('shows connection status, the default model picker, and disconnect for connected Cursor', async () => {
    mocks.status.data = {
      registered: true,
      defaultModelId: null,
      updatedAt: '2026-08-27T12:00:00Z',
    };
    mocks.models.data.models.push({
      id: 'another-model',
      name: 'Another Model',
    });

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByText(/does not revoke it in Cursor/)).toBeTruthy();

    chooseModelOption(screen.getByLabelText('Default model'), 'Another Model');
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith('another-model');
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

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
  });

  it('hides the empty paired runtimes section', () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.queryByText('No paired runtimes yet')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Paired runtimes' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Enter pairing code' })
    ).toBeNull();
  });

  it('asks to pair a new runtime from New runtime', () => {
    const onNewRuntime = vi.fn();
    render(() => <AgentRuntimes onNewRuntime={onNewRuntime} />);

    fireEvent.click(screen.getByRole('button', { name: 'New runtime' }));
    expect(onNewRuntime).toHaveBeenCalledOnce();
  });

  it('renders a registered harness row', () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

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

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeTruthy();
    expect(screen.getByText('Never connected')).toBeTruthy();
  });

  it('confirms before removing a harness', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove Dev box?')).toBeTruthy();
    expect(
      within(dialog).getByText(/Agents using this runtime will stop running/)
    ).toBeTruthy();
    expect(harnessMocks.deleteHarness).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove runtime' })
    );

    await waitFor(() => {
      expect(harnessMocks.deleteHarness).toHaveBeenCalledWith({
        harnessId: REGISTERED_HARNESS.id,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Runtime removed');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
