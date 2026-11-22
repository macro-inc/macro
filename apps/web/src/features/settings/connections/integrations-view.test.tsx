import {
  clearPendingConnectApp,
  requestConnectApp,
} from '@core/connectors/pendingConnect';
import type { Connector, ConnectorStatus } from '@queries/connectors';
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
import { useConnectionsView } from './view-state';

const mocks = vi.hoisted(() => ({
  connectors: [] as Connector[],
  connect: vi.fn(),
  readConnectors: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  discover: vi.fn(),
  importChannels: vi.fn(),
  failure: vi.fn(),
  granolaConnected: false,
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
  toast: { failure: mocks.failure, success: vi.fn() },
}));
// The real import module loads websocket infrastructure during initialization.
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
  // Modules the view pulls in register their handlers at import time.
  ws: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
}));
// The server's list; everything else in the view reads it through the hook.
vi.mock('@queries/connectors', () => ({
  GITHUB_CONNECTOR_KEY: 'app/github',
  appConnectorKey: (slug: string) => `app/${slug}`,
  connectConnector: mocks.connect,
  readConnectors: mocks.readConnectors,
  useConnectors: () => ({
    list: () => mocks.connectors,
    ready: () => true,
    error: () => false,
    retry: vi.fn(),
  }),
  useConnectorCatalogIconsQuery: () => ({ isPending: true, data: undefined }),
  createConnectorCatalogSearch: () => ({
    search: () => '',
    searchInput: () => '',
    onSearchInput: vi.fn(),
    entries: () => [],
    query: { isFetching: false },
  }),
  useUpdateConnectorMutation: () => ({
    mutate: mocks.update,
    isPending: false,
  }),
  useRemoveConnectorMutation: () => ({
    mutate: mocks.remove,
    isPending: false,
  }),
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
    useEmailItems: () => () => [],
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
vi.mock('./catalog-rows', () => ({
  CatalogRows: () => <p>Integration catalog</p>,
}));
vi.mock('./ai-provider', () => ({
  AiProviderPage: (props: { provider: string }) => {
    const view = useConnectionsView();
    return (
      <>
        <h1>{props.provider} agent tools</h1>
        <button onClick={view.closeProvider}>Back to integrations</button>
      </>
    );
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

function connector(
  target: Connector['target'],
  name: string,
  status: ConnectorStatus = 'connected',
  overrides: Partial<Connector> = {}
): Connector {
  return {
    key:
      target.type === 'app'
        ? `app/${target.slug}`
        : `server/${btoa(target.url).replace(/=+$/, '')}`,
    target,
    name,
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
    ...overrides,
  };
}

const CUSTOM_SERVER = connector(
  { type: 'server', url: 'https://tools.example.com/mcp' },
  'Team tools'
);

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingConnectApp();
  mocks.connectors = [];
  mocks.readConnectors.mockResolvedValue([]);
  mocks.granolaConnected = false;
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
    mocks.connectors = [connector({ type: 'app', slug: 'slack' }, 'Slack')];
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
      key: 'app/slack',
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
      expect(mocks.connect).toHaveBeenCalledWith({ key: 'app/linear' })
    );
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});

describe('GitHub connect requests', () => {
  function requestGithub() {
    requestConnectApp('github');
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
        onOpenLocalAgents={() => {}}
      />
    ));
  }

  it.each(['connected', 'disabled'] as const)(
    'shows GitHub agent tools instead of relinking a %s account',
    async (status) => {
      mocks.readConnectors.mockResolvedValueOnce([
        connector({ type: 'app', slug: 'github' }, 'GitHub', status),
      ]);
      requestGithub();
      await screen.findByText('github agent tools');
      expect(mocks.connect).not.toHaveBeenCalled();
    }
  );

  it('links an unlinked or expired account', async () => {
    mocks.readConnectors.mockResolvedValueOnce([
      connector({ type: 'app', slug: 'github' }, 'GitHub', 'needsReauth'),
    ]);
    mocks.connect.mockResolvedValueOnce('closed');
    requestGithub();
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ key: 'app/github' })
    );
    expect(screen.queryByText('github agent tools')).toBeNull();
  });

  it('links when the connector list cannot be read', async () => {
    mocks.readConnectors.mockRejectedValueOnce(new Error('offline'));
    mocks.connect.mockResolvedValueOnce('closed');
    requestGithub();
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ key: 'app/github' })
    );
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
    mocks.connectors = [
      connector({ type: 'app', slug: 'posthog' }, 'PostHog'),
      CUSTOM_SERVER,
    ];
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
    expect(names.slice(0, 3)).toEqual(['Team tools', 'Granola', 'PostHog']);
    expect(names).toContain('GitHub');
    expect(screen.getByText('Integration catalog')).toBeTruthy();
  });

  it('lists native Linear and Notion connections as servers, with the server status', () => {
    mocks.connectors = [
      connector(
        { type: 'server', url: 'https://mcp.linear.app/mcp' },
        'My issues',
        'needsReauth'
      ),
      connector(
        { type: 'server', url: 'https://mcp.notion.com/mcp' },
        'Notion',
        'connected'
      ),
      connector({ type: 'app', slug: 'stripe' }, 'Stripe', 'notConnected'),
    ];
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    const rows = screen.getAllByRole('row').slice(1);
    const row = (name: string) => {
      const found = rows.find((item) => item.textContent?.includes(name));
      if (!found) throw new Error(`no row for ${name}`);
      return found;
    };
    expect(row('My issues').textContent).toContain('mcp.linear.app/mcp');
    expect(row('My issues').textContent).toContain('Custom MCP');
    expect(row('My issues').textContent).toContain('Reconnect required');
    expect(row('Notion').textContent).toContain('Custom MCP');
    // A held connection that no longer counts says so.
    expect(row('Stripe').textContent).toContain('Not connected');
  });

  it.each(['connected', 'notConnected'] as const)(
    'offers sign-in on a %s server, by the key the server gave',
    async (status) => {
      // A server counts as connected with or without a sign-in, so a server
      // that needs OAuth must still be signable from its row.
      const linear = connector(
        { type: 'server', url: 'https://mcp.linear.app/mcp' },
        'My issues',
        status
      );
      mocks.connectors = [linear];
      mocks.connect.mockResolvedValueOnce('closed');
      render(() => (
        <IntegrationsView
          onOpenEmailSettings={() => {}}
          onOpenMacroMcp={() => {}}
        />
      ));
      fireEvent.click(
        screen.getByRole('button', { name: 'Sign in to My issues' })
      );
      await waitFor(() =>
        expect(mocks.connect).toHaveBeenCalledWith({
          key: linear.key,
          container: undefined,
        })
      );
    }
  );

  it('offers Reconnect on a server whose sign-in stopped working', () => {
    mocks.connectors = [
      connector(
        { type: 'server', url: 'https://tools.example.com/mcp' },
        'Team tools',
        'needsReauth'
      ),
    ];
    render(() => (
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    ));
    expect(
      screen.getByRole('button', { name: 'Reconnect to Team tools' })
    ).toBeTruthy();
  });

  it('shows an app with a row of its own only once', () => {
    mocks.granolaConnected = true;
    mocks.connectors = [
      connector({ type: 'app', slug: 'granola' }, 'Granola'),
      connector({ type: 'app', slug: 'hubspot' }, 'HubSpot'),
    ];
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
    expect(names.filter((name) => name === 'Granola')).toHaveLength(1);
    expect(names).toContain('HubSpot');
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
