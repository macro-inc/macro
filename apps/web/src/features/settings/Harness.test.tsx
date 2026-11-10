const codexAccess = vi.hoisted(() => ({ enabled: true }));
vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => codexAccess.enabled,
}));

/**
 * @vitest-environment jsdom
 */

import { ThrownResultError } from '@core/util/result';
import { useAgentModelsQuery } from '@queries/agents/models';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
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
import { Harness } from './Harness';
import {
  requestRuntimeShare,
  runtimeShareRequest,
} from './runtimeSettingsState';
import { chooseModelOption } from './tests/select-helpers';

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('./codex/views/CodexHarness', () => ({
  CodexHarness: () => <div data-testid="codex-harness" />,
}));

vi.mock('./components/pending-requests-section', () => ({
  PendingRequestsSection: () => null,
}));

vi.mock('./computers/views/MacroComputers', () => ({
  MacroComputers: () => null,
}));

vi.mock('./computers/primitives/team-computers', () => ({
  useTeamComputers: () => ({
    // With computers on, a computer's harness is listed only under them.
    enabled: () => true,
    computers: () => [],
    failed: () => false,
  }),
}));

vi.mock('./components/teammate-runtimes-section', () => ({
  TeammateRuntimesSection: () => null,
}));

vi.mock('@app/features/runtime-sharing/views/RuntimeShareDialog', () => ({
  RuntimeShareDialog: (props: { harness: { name: string } }) => (
    <div role="dialog" aria-label={`Share ${props.harness.name}`} />
  ),
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
  patchHarness: vi.fn(),
  approve: vi.fn(),
  pairing: {
    data: {
      code: 'KX7M-4QHD',
      requested_name: 'Dev laptop',
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
  useSetCursorDefaultModel: () => ({
    mutateAsync: mocks.setDefaultModel,
    isPending: false,
  }),
}));

vi.mock('@queries/agents/models', () => ({
  useAgentModelsQuery: vi.fn(() => mocks.models),
}));

vi.mock('@queries/agents/capabilities', () => ({
  useAgentCapabilitiesQuery: () => ({
    isPending: false,
    data: { configOptions: [] },
  }),
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => harnessMocks.query,
  useDeleteHarnessMutation: () => ({
    mutateAsync: harnessMocks.deleteHarness,
    isPending: false,
  }),
  usePatchHarnessMutation: () => ({
    mutateAsync: harnessMocks.patchHarness,
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
    get isSuccess() {
      return Boolean(code()) && !harnessMocks.pairing.isError;
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

vi.mock('@app/features/access-requests/access-requests', () => ({
  useShareRequests: () => ({
    state: () => ({ pendingCount: 2 }),
  }),
}));

vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({ data: { team: { id: 'team-1' } } }),
  useIsTeamOwner: () => () => false,
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
  allow_permission_bypass: false,
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'user', user_id: 'macro|user@example.com' },
  access: 'owner',
  shared_team_ids: ['team-1'],
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
};

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  Element.prototype.scrollTo = vi.fn();
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
  harnessMocks.pairing.isError = false;
  harnessMocks.deleteHarness.mockResolvedValue(undefined);
  harnessMocks.approve.mockResolvedValue(REGISTERED_HARNESS);
  harnessMocks.searchParams.pair = undefined;
});

describe('Harness', () => {
  it.each([false, true])(
    'shows Codex settings only within its rollout (access %s)',
    (enabled) => {
      codexAccess.enabled = enabled;
      render(() => <Harness />);
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
            <Harness />
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
    render(() => <Harness />);

    expect(screen.getByRole('heading', { name: 'Macro Agent' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cursor' })).toBeTruthy();
    expect(
      screen.getByText(/Uses official Macro tools and MCPs to get the job done/)
    ).toBeTruthy();
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
    render(() => <Harness />);

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

    render(() => <Harness />);

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByLabelText('API key')).toBeNull();
    expect(screen.getByText(/does not revoke it in Cursor/)).toBeTruthy();

    chooseModelOption(screen.getByLabelText('Default model'), 'Another Model');
    await waitFor(() => {
      expect(mocks.setDefaultModel).toHaveBeenCalledWith({
        modelId: 'another-model',
      });
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

  it('hides the empty paired runtimes section', () => {
    render(() => <Harness />);

    expect(screen.queryByText('No paired machines yet')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Your machines' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Enter pairing code' })
    ).toBeNull();
  });

  it('opens pairing from New runtime and returns to the runtimes list', () => {
    render(() => <Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'New machine' }));
    expect(screen.getByRole('region', { name: 'New machine' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Machines' })).toBeTruthy();
  });

  it('goes back to Agents from the runtimes page', () => {
    const onBack = vi.fn();
    render(() => <Harness onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Agents' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders a runtime row with its access, requests and last connection', () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <Harness />);

    expect(screen.getByRole('heading', { name: 'Your machines' })).toBeTruthy();
    expect(screen.getByText('Dev box')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy();
    const row = screen.getByText('Dev box').closest('[data-runtime-row]');
    expect(row?.textContent).toMatch(
      /Team machine · 2 requests · Last connected /
    );
    expect(
      screen.queryByRole('switch', { name: /bypass|Don't ask/ })
    ).toBeNull();
  });

  it('lists an offline runtime below the connected ones', () => {
    const offline = {
      ...REGISTERED_HARNESS,
      id: 'harness-offline',
      name: 'Old laptop',
      shared_team_ids: [],
      connected: false,
      last_connected_at: null,
    };
    harnessMocks.query.data = [offline, REGISTERED_HARNESS];

    render(() => <Harness />);

    expect(screen.getByRole('img', { name: 'Offline' })).toBeTruthy();
    const old = screen.getByText('Old laptop').closest('[data-runtime-row]');
    expect(old?.textContent).toMatch(/Private · 2 requests · Never connected/);
    const names = screen
      .getAllByText(/Dev box|Old laptop/)
      .map((node) => node.textContent);
    expect(names).toEqual(['Dev box', 'Old laptop']);
  });

  it('lists a machine that is offline, so its owner can still manage it', () => {
    harnessMocks.query.data = [
      {
        ...REGISTERED_HARNESS,
        connected: false,
        last_connected_at: '2026-10-24T00:47:21Z',
      },
    ];

    render(() => <Harness />);

    const row = document.querySelector('[data-runtime-row="Dev box"]');
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByRole('button', { name: 'Remove' })
    ).toBeTruthy();
  });

  it("leaves teammates' runtimes out of Your runtimes", () => {
    harnessMocks.query.data = [
      {
        ...REGISTERED_HARNESS,
        owner: { type: 'user', user_id: 'macro|teammate@example.com' },
        access: 'user',
      },
    ];

    render(() => <Harness />);

    expect(screen.queryByText('Dev box')).toBeNull();
  });

  it('gives the owner Share, Options, Rename and Remove', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <Harness />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Share, 2 access requests' })
    );
    expect(
      await screen.findByRole('dialog', { name: 'Share Dev box' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Options' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('opens the Share menu of the runtime an access request is about', async () => {
    harnessMocks.query.data = [
      REGISTERED_HARNESS,
      { ...REGISTERED_HARNESS, id: 'harness-other', name: 'Other box' },
    ];
    requestRuntimeShare(REGISTERED_HARNESS.id, true);

    render(() => <Harness />);

    expect(
      await screen.findByRole('dialog', { name: 'Share Dev box' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('dialog', { name: 'Share Other box' })
    ).toBeNull();
    const row = screen.getByText('Dev box').closest('[data-runtime-row]');
    await waitFor(() => expect(row?.classList.contains('ring-2')).toBe(true));
    expect(runtimeShareRequest()).toBeUndefined();
  });

  it('points out a runtime without opening Share for a granted request', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];
    requestRuntimeShare(REGISTERED_HARNESS.id, false);

    render(() => <Harness />);

    const row = screen.getByText('Dev box').closest('[data-runtime-row]');
    await waitFor(() => expect(row?.classList.contains('ring-2')).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirms before removing a harness', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove Dev box?')).toBeTruthy();
    expect(
      within(dialog).getByText(/Agents using this machine will stop running/)
    ).toBeTruthy();
    expect(harnessMocks.deleteHarness).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove machine' })
    );

    await waitFor(() => {
      expect(harnessMocks.deleteHarness).toHaveBeenCalledWith({
        harnessId: REGISTERED_HARNESS.id,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Machine removed');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('sends one removal for a double click and treats an already removed machine as removed', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];
    let finish: (value: undefined) => void = () => {};
    harnessMocks.deleteHarness.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    );

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', {
      name: 'Remove machine',
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(harnessMocks.deleteHarness).toHaveBeenCalledTimes(1);
    finish(undefined);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    harnessMocks.deleteHarness.mockRejectedValueOnce(
      new ThrownResultError([
        { code: 'NOT_FOUND', message: 'Resource not found' },
      ])
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Remove machine',
      })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.toastFailure).not.toHaveBeenCalled();
    expect(invalidateHarnesses).toHaveBeenCalled();
  });

  it('lists a Macro computer only under Macro computers, without Remove or Rename', () => {
    harnessMocks.query.data = [
      { ...REGISTERED_HARNESS, access: 'owner', computer_id: 'computer-1' },
    ];

    render(() => <Harness />);
    expect(screen.queryByText('Dev box')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('renames a paired runtime', async () => {
    harnessMocks.query.data = [{ ...REGISTERED_HARNESS, access: 'owner' }];

    render(() => <Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Name');
    fireEvent.input(input, { target: { value: '  Studio  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(harnessMocks.patchHarness).toHaveBeenCalledWith({
        harnessId: REGISTERED_HARNESS.id,
        name: 'Studio',
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens the pairing dialog prefilled from the pair search param', async () => {
    harnessMocks.searchParams.pair = 'KX7M-4QHD';

    render(() => <Harness />);

    const dialog = screen.getByRole('region', { name: 'New machine' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(dialog).getByText('KX7M-4QHD')).toBeTruthy();
    expect(within(dialog).getByText('Dev laptop')).toBeTruthy();
    expect(harnessMocks.setSearchParams).toHaveBeenCalledWith(
      { pair: undefined },
      { replace: true }
    );
  });
  it('uses the supplied return destination for the back button', () => {
    const onBack = vi.fn();
    render(() => <Harness onBack={onBack} backLabel="Integrations" />);
    fireEvent.click(screen.getByRole('button', { name: 'Integrations' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
