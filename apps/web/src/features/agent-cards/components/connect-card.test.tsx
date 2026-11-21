import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connectedSlugs: new Set<string>(),
  connectedServers: new Set<string>(),
  listedServers: new Set<string>(),
  serversReady: true,
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
    ready: () => mocks.serversReady,
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
    title?: string;
  }) => (
    <div
      data-testid="add-mcp-dialog"
      data-open={String(props.open)}
      data-title={props.title}
      data-name={props.initialName}
      data-url={props.initialUrl}
    />
  ),
}));

import {
  AppConnectionContext,
  ConnectCardAccessContext,
} from '@core/pipedream/connection-context';
import { ConnectCard } from './connect-card';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connectedSlugs.clear();
  mocks.connectedServers.clear();
  mocks.listedServers.clear();
  mocks.serversReady = true;
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

  it("connects an app outside the session for the session's owner and asks for a reply", async () => {
    mocks.connectPipedreamApp.mockResolvedValue('connected');
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => true }}>
        <ConnectCard
          name="Linear"
          target={{ kind: 'app', appSlug: 'linear' }}
        />
      </ConnectCardAccessContext.Provider>
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

  it("disables Connect outside the session for anyone but the session's owner", () => {
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => false }}>
        <ConnectCard
          name="Linear"
          target={{ kind: 'app', appSlug: 'linear' }}
        />
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </ConnectCardAccessContext.Provider>
    ));

    for (const name of ['Connect Linear', 'Connect Acme']) {
      const button = screen.getByRole('button', { name });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(button.getAttribute('title')).toBe(
        "Only the session's owner can connect this"
      );
      fireEvent.click(button);
    }
    expect(mocks.connectPipedreamApp).not.toHaveBeenCalled();
    expect(mocks.connectMcpServer).not.toHaveBeenCalled();
  });

  it('disables Connect where no one says who may connect', () => {
    render(() => (
      <ConnectCard name="Linear" target={{ kind: 'app', appSlug: 'linear' }} />
    ));

    expect(
      screen
        .getByRole('button', { name: 'Connect Linear' })
        .hasAttribute('disabled')
    ).toBe(true);
  });

  it("names a server card's host", () => {
    render(() => (
      <ConnectCard
        name="Linear"
        target={{ kind: 'server', url: 'https://linear-mcp.evil.example/mcp' }}
      />
    ));

    expect(screen.getByText('MCP server · linear-mcp.evil.example')).toBeTruthy();
  });

  it('asks to add an unlisted server, naming its host, before any sign-in', () => {
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => true }}>
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </ConnectCardAccessContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    const dialog = screen.getByTestId('add-mcp-dialog');
    expect(dialog.dataset.open).toBe('true');
    expect(dialog.dataset.title).toBe('Add mcp.acme.example?');
    expect(dialog.dataset.name).toBe('Acme');
    expect(dialog.dataset.url).toBe('https://mcp.acme.example/mcp');
    expect(mocks.connectMcpServer).not.toHaveBeenCalled();
  });

  it('authorizes a server the user has added by its URL in one click', async () => {
    mocks.listedServers.add('https://mcp.acme.example/mcp');
    mocks.connectMcpServer.mockResolvedValue('connected');
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => true }}>
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </ConnectCardAccessContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    expect(mocks.connectMcpServer).toHaveBeenCalledWith({
      url: 'https://mcp.acme.example/mcp',
      name: 'Acme',
    });
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled());
    expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('false');
  });

  it('says a server already added may need no sign-in when its sign-in cannot start', async () => {
    mocks.listedServers.add('https://mcp.acme.example/mcp');
    mocks.connectMcpServer.mockRejectedValue(new Error('no oauth'));
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => true }}>
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </ConnectCardAccessContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    await waitFor(() =>
      expect(mocks.toastAlert).toHaveBeenCalledWith(
        'Could not start a sign-in for Acme. If it needs none, reply to continue.'
      )
    );
    expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('false');
  });

  it('asks to try again, starting nothing, before the server list has loaded', () => {
    mocks.serversReady = false;
    render(() => (
      <ConnectCardAccessContext.Provider value={{ allowed: () => true }}>
        <ConnectCard
          name="Acme"
          target={{ kind: 'server', url: 'https://mcp.acme.example/mcp' }}
        />
      </ConnectCardAccessContext.Provider>
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Connect Acme' }));

    expect(mocks.toastAlert).toHaveBeenCalledWith(
      'Could not start a sign-in for Acme. Please try again.'
    );
    expect(mocks.connectMcpServer).not.toHaveBeenCalled();
    expect(screen.getByTestId('add-mcp-dialog').dataset.open).toBe('false');
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

  it('fills the transcript column, as the other cards the user acts on do', () => {
    const { container } = render(() => (
      <ConnectCard name="Acme" target={{ kind: 'app', appSlug: 'acme' }} />
    ));

    const card = container.querySelector('[data-agent-card="connect"]');
    expect(card?.classList.contains('max-w-none')).toBe(true);
    expect(card?.classList.contains('max-w-md')).toBe(false);
  });
});
