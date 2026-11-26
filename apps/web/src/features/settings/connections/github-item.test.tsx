/** @vitest-environment jsdom */

import { queryClient } from '@queries/client';
import type { Connector, ConnectorStatus } from '@queries/connectors';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGithubItem } from './integration-items';
import { IntegrationItemRow } from './integrations-list';
import { toConnectionsModel } from './model';
import { ConnectionsViewProvider } from './view-state';

const mocks = vi.hoisted(() => ({
  linked: true,
  start: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
  reservePopup: vi.fn(),
  assignUrl: vi.fn(),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
// The account link says linked: the user linked GitHub before joining
// Macro Connect, so the link no longer counts.
vi.mock('../GitHub', () => ({
  GITHUB_APP_INSTALL_URL: 'https://storage.example/github/install-sync',
  useGithubAccountLink: () => ({
    linked: () => mocks.linked,
    username: () => (mocks.linked ? 'octocat' : undefined),
  }),
}));
vi.mock('@core/pipedream/oauth-popup', () => ({
  reserveOauthPopup: mocks.reservePopup,
  assignOauthUrl: mocks.assignUrl,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: vi.fn(), failure: vi.fn() },
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    startConnectorConnect: mocks.start,
    completeConnectorConnect: mocks.complete,
    removeConnector: mocks.remove,
  },
}));

function github(status: ConnectorStatus): Connector {
  return {
    key: 'app/github',
    target: { type: 'app', slug: 'github' },
    name: 'GitHub',
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
  };
}

function GithubRow(props: { connectors: Connector[] }) {
  const item = useGithubItem(() => toConnectionsModel(props.connectors));
  return <IntegrationItemRow item={item} />;
}

function renderRow(connectors: Connector[]) {
  render(() => (
    <QueryClientProvider client={queryClient}>
      <ConnectionsViewProvider>
        <GithubRow connectors={connectors} />
      </ConnectionsViewProvider>
    </QueryClientProvider>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.linked = true;
  mocks.reservePopup.mockReturnValue({ closed: true, close: vi.fn() });
  mocks.complete.mockResolvedValue(
    err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
  );
});
afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('the GitHub row', () => {
  it("reads the server's answer, not the account link", () => {
    renderRow([github('notConnected')]);
    // The link's username still shows; the status does not come from it.
    expect(screen.getByText(/@octocat/)).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeTruthy();
  });

  it('connects by asking the server and opening the page it answers', async () => {
    const tab = { closed: true, close: vi.fn() };
    mocks.reservePopup.mockReturnValue(tab);
    mocks.start.mockResolvedValue(
      ok({ type: 'openUrl', url: 'https://connect.example/consent/github' })
    );
    renderRow([github('notConnected')]);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    await vi.waitFor(() =>
      expect(mocks.start).toHaveBeenCalledWith({ key: 'app/github' })
    );
    await vi.waitFor(() =>
      expect(mocks.assignUrl).toHaveBeenCalledWith(
        tab,
        'https://connect.example/consent/github'
      )
    );
  });

  it('reads connected when the server says so', () => {
    renderRow([github('connected')]);
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect GitHub' })).toBeNull();
  });

  it('asks to reconnect a link whose token stopped working', () => {
    renderRow([github('needsReauth')]);
    expect(screen.getByText('Reconnect required')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reconnect GitHub' })
    ).toBeTruthy();
  });
});
