import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectedSlugs: new Set<string>(),
  connectedServers: new Set<string>(),
  listedServers: new Set<string>(),
  connectPipedreamApp: vi.fn(),
  connectMcpServer: vi.fn(),
  toastSuccess: vi.fn(),
  toastAlert: vi.fn(),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamConnectedSlugs: () => ({
    ready: () => true,
    slugs: () => mocks.connectedSlugs,
  }),
  useMcpServerConnected: (url: () => string) => ({
    ready: () => true,
    connected: () => mocks.connectedServers.has(url()),
    listed: () => mocks.listedServers.has(url()),
  }),
  connectPipedreamApp: mocks.connectPipedreamApp,
  connectMcpServer: mocks.connectMcpServer,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess, alert: mocks.toastAlert },
}));
vi.mock('@core/pipedream/ConnectorIcon', () => ({
  PipedreamConnectorIcon: () => <span data-pipedream-icon />,
}));
vi.mock('@app/features/settings/connections/add-custom-mcp-dialog', () => ({
  AddCustomMcpDialog: (props: {
    open: boolean;
    initialName?: string;
    initialUrl?: string;
  }) => (
    <div
      data-testid="add-mcp-dialog"
      data-open={String(props.open)}
      data-name={props.initialName}
      data-url={props.initialUrl}
    />
  ),
}));

import { AppConnectionContext } from '@core/pipedream/connection-context';
import { ConnectCard } from './connect-card';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectedSlugs.clear();
  mocks.connectedServers.clear();
  mocks.listedServers.clear();
});

describe('connect card', () => {
  it('connects an app through the agent session that presented it', () => {
    const connect = vi.fn(async () => {});
    render(() => (
      <AppConnectionContext.Provider value={{ connect, disabled: () => false }}>
        <ConnectCard
          name="Linear"
          target={{ kind: 'app', appSlug: 'linear' }}
        />
      </AppConnectionContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));

    expect(connect).toHaveBeenCalledWith({ appSlug: 'linear', name: 'Linear' });
    expect(mocks.connectPipedreamApp).not.toHaveBeenCalled();
  });

  it('shows an app that is already connected without a Connect button', () => {
    mocks.connectedSlugs.add('linear');
    render(() => (
      <ConnectCard name="Linear" target={{ kind: 'app', appSlug: 'linear' }} />
    ));

    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Linear' })).toBeNull();
  });

  it('connects an app outside a session and asks for a reply to continue', async () => {
    mocks.connectPipedreamApp.mockResolvedValue('connected');
    render(() => (
      <ConnectCard name="Linear" target={{ kind: 'app', appSlug: 'linear' }} />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));

    expect(mocks.connectPipedreamApp).toHaveBeenCalledWith({
      appSlug: 'linear',
      serverName: 'Linear',
    });
    await waitFor(() =>
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        'Linear connected. Reply when you are ready to continue.'
      )
    );
  });

  it('authorizes an MCP server by its URL in one click', async () => {
    mocks.connectMcpServer.mockResolvedValue('connected');
    render(() => (
      <ConnectCard
        name="Acme"
        target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    expect(mocks.connectMcpServer).toHaveBeenCalledWith({
      url: 'https://mcp.acme.example/mcp',
      name: 'Acme',
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('false');
  });

  it('opens the add-server dialog, filled in, when the server offers no sign-in', async () => {
    mocks.connectMcpServer.mockRejectedValue(new Error('no oauth'));
    render(() => (
      <ConnectCard
        name="Acme"
        target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    await waitFor(() =>
      expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('true')
    );
    const dialog = screen.getByTestId('add-mcp-dialog');
    expect(dialog.dataset.name).toBe('Acme');
    expect(dialog.dataset.url).toBe('https://mcp.acme.example/mcp');
  });

  it('disables Connect without showing a sign-in when the session cannot connect', () => {
    render(() => (
      <AppConnectionContext.Provider
        value={{ connect: vi.fn(async () => {}), disabled: () => true }}
      >
        <ConnectCard
          name="Linear"
          target={{ kind: 'app', appSlug: 'linear' }}
        />
      </AppConnectionContext.Provider>
    ));

    const button = screen.getByRole('button', { name: 'Connect Linear' });
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.textContent).toBe('Connect');
  });

  it('asks to try again, without the add-server dialog, for a server already added', async () => {
    mocks.listedServers.add('https://mcp.acme.example/mcp');
    mocks.connectMcpServer.mockRejectedValue(new Error('network'));
    render(() => (
      <ConnectCard
        name="Acme"
        target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    await waitFor(() =>
      expect(mocks.toastAlert).toHaveBeenCalledWith(
        'Could not start the sign-in for Acme.'
      )
    );
    expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('false');
  });

  it('disables a server card while the session cannot connect', () => {
    render(() => (
      <AppConnectionContext.Provider
        value={{ connect: vi.fn(async () => {}), disabled: () => true }}
      >
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </AppConnectionContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    expect(
      screen
        .getByRole('button', { name: 'Connect Acme' })
        .hasAttribute('disabled')
    ).toBe(true);
    expect(mocks.connectMcpServer).not.toHaveBeenCalled();
  });
});
