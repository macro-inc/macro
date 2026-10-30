import {
  clearPendingConnectApp,
  requestConnectApp,
} from '@core/pipedream/pendingConnect';
import type { ImportState } from '@queries/import';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsView } from './integrations-view';
import type { Leftover } from './model';
import { useConnectionsView } from './view-state';

const mocks = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  discover: vi.fn(),
  importChannels: vi.fn(),
  failure: vi.fn(),
  granolaConnected: false,
  leftovers: [] as Leftover[],
  overlaysLoading: false,
}));
const [state, setState] = createSignal<ImportState>({ runs: [], entities: [] });
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@queries/team/teams', () => ({
  useCurrentTeamQuery: () => ({
    isSuccess: true,
    data: { team: { id: 'team' } },
  }),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
// The real import module loads websocket infrastructure during initialization.
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  connectPipedreamApp: mocks.connect,
  usePipedreamConnectedSlugs: () => ({ slugs: () => new Set<string>() }),
  usePipedreamOverlaysQuery: () => ({
    isPending: false,
    data: [],
    get isPlaceholderData() {
      return mocks.overlaysLoading;
    },
  }),
  overlaidAppSlug: () => undefined,
}));
vi.mock('./use-connections-model', () => ({
  useConnectionsModel: () => ({
    model: () => ({
      capabilities: [],
      leftovers: mocks.leftovers,
      providers: [],
    }),
    ready: () => true,
    error: () => false,
    partialError: () => false,
    retry: vi.fn(),
  }),
}));
vi.mock('./model', () => ({
  capabilitiesFor: () =>
    mocks.connected ? [{ mechanism: 'pipedream', status: 'connected' }] : [],
}));
vi.mock('./add-custom-mcp-dialog', () => ({ AddCustomMcpDialog: () => null }));
// Stand-ins for rows whose real sources read account, team and email queries.
vi.mock('./integration-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./integration-items')>();
  const item = (name: string, Actions: () => JSX.Element) => ({
    id: name,
    name,
    icon: null,
    description: `${name} description`,
    categories: ['Agent tools'],
    get status() {
      return name === 'Granola' && mocks.granolaConnected
        ? ('connected' as const)
        : ('available' as const);
    },
    Actions,
  });
  return {
    ...actual,
    useEmailItems: () => [],
    useGithubItem: () => item('GitHub', () => null),
    useGranolaItem: () => item('Granola', () => null),
    useAgentProviderItem: (_model: unknown, provider: 'slack' | 'linear') =>
      item(provider === 'slack' ? 'Slack' : provider, () => {
        const view = useConnectionsView();
        return (
          <button onClick={() => view.openProvider(provider)}>
            Manage {provider}
          </button>
        );
      }),
  };
});
// The real row reads connection mutations.
vi.mock('./leftover-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./leftover-row')>()),
  LeftoverRow: (props: { leftover: Leftover }) => (
    <div role="row">
      <span class="font-medium">{props.leftover.title}</span>
    </div>
  ),
}));
vi.mock('./catalog-rows', () => ({
  CatalogRows: () => <p>Integration catalog</p>,
}));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogSearch: () => ({
    search: () => '',
    searchInput: () => '',
    onSearchInput: vi.fn(),
    entries: () => [],
    query: { isFetching: false },
  }),
}));
vi.mock('./PipedreamAiProvider', () => ({
  PipedreamAiProvider: () => {
    const view = useConnectionsView();
    return <button onClick={view.closeProvider}>Back to integrations</button>;
  },
}));
vi.mock('@queries/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/import')>()),
  useImportQuery: () => ({
    isSuccess: true,
    get data() {
      return state();
    },
  }),
  useDiscoverMutation: () => ({ mutate: mocks.discover, isPending: false }),
  useRunImportMutation: () => ({
    mutate: mocks.importChannels,
    isPending: false,
  }),
}));
vi.mock('@ui', async () => ({
  ...(await vi.importActual('@ui')),
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('../primitives', () => ({
  SettingsSurface: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
  SettingsPage: (props: {
    title: string;
    description: string;
    children: JSX.Element;
    onBack?: () => void;
  }) => (
    <section>
      <h1>{props.title}</h1>
      <p>{props.description}</p>
      {props.children}
      <button onClick={props.onBack}>Back</button>
    </section>
  ),
  SettingsSection: (props: { title: string; children: JSX.Element }) => (
    <section aria-label={props.title}>
      <h2>{props.title}</h2>
      {props.children}
    </section>
  ),
  SettingsCard: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
  IntegrationRow: (props: {
    title: JSX.Element;
    description?: JSX.Element;
    children?: JSX.Element;
  }) => (
    <div>
      <span>{props.title}</span>
      <span>{props.description}</span>
      {props.children}
    </div>
  ),
}));

const CUSTOM_SERVER: Leftover = {
  kind: 'native-mcp',
  id: 'mcp:https://tools.example.com/mcp',
  title: 'Team tools',
  subtitle: 'tools.example.com',
  url: 'https://tools.example.com/mcp',
  enabled: true,
  authenticated: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingConnectApp();
  mocks.connected = false;
  mocks.granolaConnected = false;
  mocks.leftovers = [];
  mocks.overlaysLoading = false;
  setState({ runs: [], entities: [] });
});
afterEach(cleanup);

function startImport() {
  requestConnectApp('slack', 'import-slack-channels');
  render(() => (
    <IntegrationsView
      onOpenEmailSettings={() => {}}
      onOpenMacroMcp={() => {}}
      onOpenLocalAgents={() => {}}
    />
  ));
}

function provideChannels() {
  setState({
    runs: [],
    entities: ['general', 'random'].map((name) => ({
      id: name,
      foreign_id: `C${name}`,
      source: 'slack',
      kind: 'channel',
      status: 'staged',
      initiator: 'manual',
      user_id: 'me',
      created_at: '',
      updated_at: '',
      metadata: { name, members_resolved: true, participants: [] },
    })),
  });
}

describe('Slack channel import handoff', () => {
  it('reuses a connection, discovers channels and imports only the selected channels', async () => {
    mocks.connected = true;
    startImport();
    await screen.findByText('Import channels without history');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.discover).toHaveBeenCalledExactlyOnceWith(
      'slack',
      expect.any(Object)
    );
    expect(mocks.importChannels).not.toHaveBeenCalled();
    provideChannels();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select general' }));
    fireEvent.click(screen.getByRole('button', { name: 'Import 1 channel' }));
    expect(mocks.importChannels).toHaveBeenCalledWith(
      { importIds: ['general'], discardIds: [] },
      expect.any(Object)
    );
  });

  it('waits for authorization, then automatically discovers channels', async () => {
    let authorize!: (outcome: string) => void;
    mocks.connect.mockReturnValueOnce(
      new Promise((resolve) => {
        authorize = resolve;
      })
    );
    startImport();
    await screen.findByRole('button', { name: 'Connecting Slack…' });
    expect(mocks.connect).toHaveBeenCalledExactlyOnceWith({
      appSlug: 'slack_v2',
      serverName: 'Slack',
    });
    expect(mocks.discover).not.toHaveBeenCalled();
    authorize('connected');
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledOnce());
    expect(screen.getByRole('button', { name: 'Find channels' })).toBeTruthy();
    expect(mocks.importChannels).not.toHaveBeenCalled();
  });

  it('allows retry after cancelling authorization without discovering or importing', async () => {
    mocks.connect.mockResolvedValueOnce('closed');
    startImport();
    await screen.findByRole('button', { name: 'Connect Slack to continue' });
    expect(mocks.discover).not.toHaveBeenCalled();
    mocks.connect.mockResolvedValueOnce('connected');
    fireEvent.click(
      screen.getByRole('button', { name: 'Connect Slack to continue' })
    );
    await waitFor(() => expect(mocks.discover).toHaveBeenCalledOnce());
    expect(mocks.importChannels).not.toHaveBeenCalled();
  });

  it('preserves ordinary external connector requests', async () => {
    mocks.connect.mockResolvedValueOnce('connected');
    requestConnectApp('linear');
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
        onOpenLocalAgents={() => {}}
      />
    ));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ appSlug: 'linear' })
    );
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});

describe('unified Integrations page', () => {
  it('hides local harness setup when no allowed entry point is supplied', () => {
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    expect(
      screen.queryByRole('button', { name: 'Set up local agents' })
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Set up Macro in AI apps' })
    ).toBeTruthy();
  });

  it('opens the matching setup flow for each callout', () => {
    const onOpenMacroMcp = vi.fn();
    const onOpenLocalAgents = vi.fn();
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={onOpenMacroMcp}
        onOpenLocalAgents={onOpenLocalAgents}
      />
    ));
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up Macro in AI apps' })
    );
    expect(onOpenMacroMcp).toHaveBeenCalledOnce();
    expect(onOpenLocalAgents).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Set up local agents' })
    );
    expect(onOpenLocalAgents).toHaveBeenCalledOnce();
  });
  it('lists custom servers first, then connected integrations, the rest and the catalog', () => {
    mocks.granolaConnected = true;
    mocks.leftovers = [CUSTOM_SERVER];
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => row.querySelector('span.font-medium')?.textContent);
    expect(names.slice(0, 2)).toEqual(['Team tools', 'Granola']);
    expect(names).toContain('GitHub');
    expect(screen.getByText('Integration catalog')).toBeTruthy();
  });

  it('holds native servers back until overlays load', () => {
    mocks.leftovers = [CUSTOM_SERVER];
    mocks.overlaysLoading = true;
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    expect(screen.queryByText('Team tools')).toBeNull();
    expect(screen.getByText('Granola')).toBeTruthy();
  });

  it('filters every row by search', () => {
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    fireEvent.input(
      screen.getByRole('searchbox', { name: 'Search integrations' }),
      { target: { value: 'granola' } }
    );
    expect(screen.getByText('Granola')).toBeTruthy();
    expect(screen.queryByText('GitHub')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Set up Macro in AI apps' })
    ).toBeNull();
  });

  it('returns from provider details to the list', () => {
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Manage slack' }));
    expect(screen.queryByText('Integration catalog')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to integrations' })
    );
    expect(screen.getByText('Integration catalog')).toBeTruthy();
  });
});
