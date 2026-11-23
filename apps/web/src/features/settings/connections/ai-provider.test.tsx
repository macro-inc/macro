import type { Connector, ConnectorStatus } from '@queries/connectors';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiProviderPage } from './ai-provider';
import { type CuratedAiProvider, toConnectionsModel } from './model';
import {
  ConnectionsViewProvider,
  createConnectionsViewState,
} from './view-state';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@core/connectors/connect-action', () => ({
  createConnectAction: (options: { key: () => string }) => ({
    connect: async () => mocks.connect(options.key()),
    busy: () => false,
  }),
}));
vi.mock('@queries/connectors', () => ({
  appConnectorKey: (slug: string) => `app/${slug}`,
  useUpdateConnectorMutation: () => ({
    mutate: mocks.update,
    isPending: false,
  }),
  useRemoveConnectorMutation: () => ({
    mutate: mocks.remove,
    isPending: false,
  }),
}));
vi.mock('./slack-channel-import/SlackChannelImportCard', () => ({
  SlackChannelImportCard: () => <p>Slack channel import</p>,
}));

function held(
  slug: string,
  status: ConnectorStatus,
  overrides: Partial<Connector> = {}
): Connector {
  return {
    key: `app/${slug}`,
    target: { type: 'app', slug },
    name: `${slug} workspace`,
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
    ...overrides,
  };
}

function renderProvider(
  provider: CuratedAiProvider,
  connectors: Connector[] = []
) {
  render(() => (
    <ConnectionsViewProvider value={createConnectionsViewState({})}>
      <AiProviderPage
        model={toConnectionsModel(connectors)}
        provider={provider}
      />
    </ConnectionsViewProvider>
  ));
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('AiProviderPage', () => {
  it('connects an app the user does not hold', async () => {
    renderProvider('linear');
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith('app/linear')
    );
  });

  it('never says which provider powers a connection', () => {
    renderProvider('linear', [held('linear', 'connected')]);
    expect(screen.queryByText(/Powered by/)).toBeNull();
    expect(screen.queryByText(/Pipedream|Macro Connect/)).toBeNull();
    expect(screen.getByText('linear workspace')).toBeTruthy();
  });

  it('says a held connection that no longer counts is not connected', () => {
    renderProvider('notion', [held('notion', 'notConnected')]);
    expect(screen.getAllByText('Not connected').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('turns a disabled connection back on by its key', () => {
    renderProvider('linear', [held('linear', 'disabled')]);
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    expect(mocks.update).toHaveBeenCalledWith(
      { key: 'app/linear', enabled: true },
      expect.anything()
    );
  });

  it('shows Slack channel import only when the connection provides it', () => {
    renderProvider('slack', [held('slack', 'connected')]);
    expect(screen.queryByText('Slack channel import')).toBeNull();
    cleanup();
    renderProvider('slack', [
      held('slack', 'connected', { importAvailable: true }),
    ]);
    expect(screen.getByText('Slack channel import')).toBeTruthy();
  });
});
