import {
  cognitionApiServiceClient,
  type PipedreamConnectionResponse,
} from '@service-cognition/client';
import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IntegrationsView } from './integrations-view';
import type { Leftover } from './model';

const mocks = vi.hoisted(() => ({
  flagOn: false,
  connections: [] as { app_slug: string; server_name: string }[],
}));

// What this file is for: the real reconnect query, row and banner, deciding
// from the flag. Every test here has the server answering with rows to
// reconnect, so only the flag keeps them off the page.
vi.mock('@core/constant/featureFlags', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@core/constant/featureFlags')>();
  return {
    ...actual,
    isFeatureEnabled: (flag: Parameters<typeof actual.isFeatureEnabled>[0]) =>
      flag === actual.macroConnect && mocks.flagOn,
  };
});
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('./import-action', () => ({ ImportAction: () => null }));
vi.mock('@queries/team/teams', () => ({
  useUserTeamsQuery: () => ({ isSuccess: false }),
}));
vi.mock('@queries/pipedream-connectors', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/pipedream-connectors')>()),
  usePipedreamConnectedSlugs: () => ({ slugs: () => new Set<string>() }),
  usePipedreamOverlaysQuery: () => ({ isPending: false, data: [] }),
}));
vi.mock('./use-connections-model', async () => {
  const { toConnectionsModel } =
    await vi.importActual<typeof import('./model')>('./model');
  return {
    useConnectionsModel: () => ({
      model: () =>
        toConnectionsModel({
          pipedream: mocks.connections.map((connection) => ({
            ...connection,
            enabled: true,
            provider: 'pipedream' as const,
          })),
          nativeMcp: [],
        }),
      ready: () => true,
      error: () => false,
      partialError: () => false,
      retry: vi.fn(),
    }),
  };
});
// Stand-ins for rows whose real sources read account, team and email queries.
vi.mock('./integration-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./integration-items')>();
  const item = (name: string) => ({
    id: name,
    name,
    icon: null,
    description: `${name} description`,
    categories: ['Agent tools'],
    status: 'available' as const,
    Actions: () => null,
  });
  return {
    ...actual,
    useEmailItems: () => () => [],
    useGithubItem: () => item('GitHub'),
    useGranolaItem: () => item('Granola'),
  };
});
vi.mock('./leftover-row', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./leftover-row')>()),
  LeftoverRow: (props: { leftover: Leftover }) => (
    <div role="row">{props.leftover.title}</div>
  ),
}));
vi.mock('./catalog-rows', () => ({ CatalogRows: () => null }));
vi.mock('@core/pipedream/catalog', () => ({
  createPipedreamCatalogConnect: () => ({
    connect: vi.fn(),
    busy: () => false,
  }),
  createPipedreamCatalogSearch: () => ({
    search: () => '',
    searchInput: () => '',
    onSearchInput: vi.fn(),
    entries: () => [],
    query: { isFetching: false },
  }),
}));
vi.mock('./PipedreamAiProvider', () => ({ PipedreamAiProvider: () => null }));
vi.mock('@service-connection/websocket', () => ({
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@queries/import', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@queries/import')>()),
  useImportQuery: () => ({
    isSuccess: true,
    data: { runs: [], entities: [] },
  }),
  useDiscoverMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useRunImportMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

const LINEAR = { app_slug: 'linear', server_name: 'Linear' };
const TODOIST = { app_slug: 'todoist', server_name: 'Todoist' };
const SERVER_RECONNECTS: PipedreamConnectionResponse[] = [LINEAR, TODOIST].map(
  (connection) => ({ ...connection, enabled: true, provider: 'pipedream' })
);
const listReconnects = vi.spyOn(
  cognitionApiServiceClient,
  'listPipedreamReconnects'
);

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(() => (
    <QueryClientProvider client={client}>
      <IntegrationsView
        onOpenEmailSettings={() => {}}
        onOpenMacroMcp={() => {}}
      />
    </QueryClientProvider>
  ));
  return client;
}

/** Waits out any fetch in flight, so a prompt it caused would be on the page. */
async function expectNoReconnectPrompt() {
  await new Promise((resolve) => setTimeout(resolve));
  expect(listReconnects).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /^Reconnect/ })).toBeNull();
  expect(screen.queryByText(/needs? reconnecting/)).toBeNull();
  expect(screen.queryByText('Reconnect required')).toBeNull();
  expect(screen.queryByText(/We moved/)).toBeNull();
}

beforeEach(() => {
  mocks.flagOn = false;
  mocks.connections = [];
  listReconnects.mockClear();
  listReconnects.mockResolvedValue(ok(SERVER_RECONNECTS));
});
afterEach(cleanup);

describe('reconnect prompts with the macro-connect flag off', () => {
  it('leaves Pipedream connections as they are and never asks the server', async () => {
    mocks.connections = [LINEAR, TODOIST];
    mount();

    expect(
      await screen.findByRole('button', { name: 'Manage Linear' })
    ).toBeTruthy();
    expect(screen.getByText('Todoist')).toBeTruthy();
    await expectNoReconnectPrompt();
  });

  it('offers the normal Connect for an app with no connection', async () => {
    mount();

    expect(
      await screen.findByRole('button', { name: 'Connect Linear' })
    ).toBeTruthy();
    await expectNoReconnectPrompt();
  });

  it('stays off the server when connections are invalidated', async () => {
    mocks.connections = [LINEAR];
    const client = mount();
    await screen.findByRole('button', { name: 'Manage Linear' });

    await client.invalidateQueries({
      queryKey: ['pipedreamConnectors', 'list'],
    });

    await expectNoReconnectPrompt();
  });
});

describe('reconnect prompts with the macro-connect flag on', () => {
  // The control: this page and server answer do prompt, so the tests above
  // can't pass for the wrong reason.
  it('prompts for the same rows', async () => {
    mocks.flagOn = true;
    mount();

    expect(await screen.findByText('2 apps need reconnecting.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reconnect Linear' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Reconnect Todoist' })
    ).toBeTruthy();
    await waitFor(() => expect(listReconnects).toHaveBeenCalledTimes(1));
  });
});
