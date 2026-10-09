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
import { ConnectionsPage } from './ConnectionsPage';

const mocks = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  discover: vi.fn(),
  importChannels: vi.fn(),
  failure: vi.fn(),
}));
const [state, setState] = createSignal<ImportState>({ runs: [], entities: [] });
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'me' }));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@core/component/TabsInset', () => ({ TabsInset: () => <div /> }));
// The real import module loads websocket infrastructure during initialization.
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  connectPipedreamApp: mocks.connect,
}));
vi.mock('./use-connections-model', () => ({
  useConnectionsModel: () => ({
    model: () => ({}),
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
vi.mock('./ConnectedView', () => ({
  ConnectedView: () => <p>Connections overview</p>,
}));
vi.mock('./DiscoverView', () => ({ DiscoverView: () => <div /> }));
vi.mock('./PipedreamAiProvider', () => ({
  PipedreamAiProvider: () => <div />,
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
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('../primitives', () => ({
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
    <section aria-label={props.title}>{props.children}</section>
  ),
  SettingsCard: (props: { children: JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  clearPendingConnectApp();
  mocks.connected = false;
  setState({ runs: [], entities: [] });
});
afterEach(cleanup);

function startImport() {
  requestConnectApp('slack', 'import-slack-channels');
  render(() => <ConnectionsPage onOpenMacroMcp={() => {}} />);
}

function provideChannels() {
  setState({
    runs: [],
    entities: ['general', 'random'].map((name) => ({
      id: name,
      foreign_id: `C${name}`,
      source: 'slack',
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
      appSlug: 'slack',
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
    render(() => <ConnectionsPage onOpenMacroMcp={() => {}} />);
    await waitFor(() =>
      expect(mocks.connect).toHaveBeenCalledWith({ appSlug: 'linear' })
    );
    expect(mocks.discover).not.toHaveBeenCalled();
  });
});
