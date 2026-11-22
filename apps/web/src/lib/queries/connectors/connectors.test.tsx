/**
 * @vitest-environment jsdom
 */

import { queryClient } from '@queries/client';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  Connector,
  ConnectorStatus,
} from '@service-cognition/connector-types';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConnectorsSource, useConnectors } from './connectors';
import {
  useRemoveConnectorMutation,
  useUpdateConnectorMutation,
} from './mutations';

const mocks = vi.hoisted(() => ({
  invalidateGithubLink: vi.fn(async () => {}),
}));

vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});
vi.mock('@queries/auth/github-link', () => ({
  invalidateGithubLinkStatus: mocks.invalidateGithubLink,
}));
vi.mock('@service-cognition/client', () => ({
  cognitionApiServiceClient: {
    listConnectors: vi.fn(),
    updateConnector: vi.fn(),
    removeConnector: vi.fn(),
  },
}));

const client = vi.mocked(cognitionApiServiceClient);

function connector(
  target: Connector['target'],
  status: ConnectorStatus
): Connector {
  return {
    key: target.type === 'app' ? `app/${target.slug}` : 'server/aHR0cHM6Ly94',
    target,
    name: target.type === 'app' ? target.slug : 'Server',
    status,
    connectable: true,
    mcp: true,
    api: false,
    importAvailable: false,
  };
}

const LIST = [
  connector({ type: 'app', slug: 'linear' }, 'connected'),
  connector({ type: 'app', slug: 'notion' }, 'disabled'),
  connector({ type: 'app', slug: 'slack' }, 'needsReauth'),
  connector({ type: 'app', slug: 'stripe' }, 'notConnected'),
  connector({ type: 'server', url: 'https://x' }, 'connected'),
];

let dispose: (() => void) | undefined;

function renderHook<T>(factory: () => T): T {
  let result!: T;
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        {(() => {
          result = factory();
          return null as unknown as JSX.Element;
        })()}
      </QueryClientProvider>
    ),
    document.body
  );
  return result;
}

function renderConnectors() {
  return renderHook(() => ({
    connectors: useConnectors(),
    update: useUpdateConnectorMutation(),
    remove: useRemoveConnectorMutation(),
  }));
}

async function loaded(connectors: ConnectorsSource) {
  await vi.waitFor(() => expect(connectors.ready()).toBe(true));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.listConnectors.mockResolvedValue(ok(LIST));
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
});

describe('useConnectors', () => {
  it('is not ready, and lists nothing, until the server answers', async () => {
    let answer!: (value: Awaited<ReturnType<typeof client.listConnectors>>) => void;
    client.listConnectors.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const { connectors } = renderConnectors();
    expect(connectors.ready()).toBe(false);
    expect(connectors.list()).toEqual([]);
    answer(ok(LIST));
    await loaded(connectors);
    expect(connectors.list()).toEqual(LIST);
  });

  it('answers with the server status and decides nothing itself', async () => {
    const { connectors } = renderConnectors();
    await loaded(connectors);
    expect(connectors.appStatus('linear')).toBe('connected');
    expect(connectors.appStatus('notion')).toBe('disabled');
    expect(connectors.appStatus('slack')).toBe('needsReauth');
    expect(connectors.appStatus('stripe')).toBe('notConnected');
    // An app the user does not hold is not connected.
    expect(connectors.appStatus('figma')).toBe('notConnected');
    expect(connectors.app('linear')?.key).toBe('app/linear');
    expect(connectors.find('server/aHR0cHM6Ly94')?.name).toBe('Server');
    // Only apps the server says are connected; servers are not apps.
    expect([...connectors.connectedApps()]).toEqual(['linear']);
  });

  it('reports a failed read without inventing an empty answer', async () => {
    client.listConnectors.mockResolvedValue(
      err([{ code: 'HTTP_ERROR', message: 'down' }])
    );
    const { connectors } = renderConnectors();
    await vi.waitFor(() => expect(connectors.error()).toBe(true));
    expect(connectors.ready()).toBe(false);
  });

  it('switches a connection off at once and keeps it on when the server refuses', async () => {
    const { connectors, update } = renderConnectors();
    await loaded(connectors);
    let refuse!: () => void;
    client.updateConnector.mockReturnValue(
      new Promise((resolve) => {
        refuse = () => resolve(err([{ code: 'HTTP_ERROR', message: 'no' }]));
      })
    );
    update.mutate({ key: 'app/linear', enabled: false });
    await vi.waitFor(() =>
      expect(connectors.appStatus('linear')).toBe('disabled')
    );
    expect(client.updateConnector).toHaveBeenCalledWith({
      key: 'app/linear',
      enabled: false,
    });
    refuse();
    await vi.waitFor(() =>
      expect(connectors.appStatus('linear')).toBe('connected')
    );
  });

  it('removes a connection, and removing GitHub refreshes the account link', async () => {
    client.listConnectors.mockResolvedValue(
      ok([...LIST, connector({ type: 'app', slug: 'github' }, 'connected')])
    );
    client.removeConnector.mockResolvedValue(ok(undefined));
    const { connectors, remove } = renderConnectors();
    await loaded(connectors);
    client.listConnectors.mockResolvedValue(ok(LIST));
    remove.mutate({ key: 'app/github' });
    await vi.waitFor(() =>
      expect(connectors.appStatus('github')).toBe('notConnected')
    );
    expect(client.removeConnector).toHaveBeenCalledWith({ key: 'app/github' });
    await vi.waitFor(() =>
      expect(mocks.invalidateGithubLink).toHaveBeenCalledOnce()
    );
  });
});
