import type { CommandWithInfo } from '@core/hotkey/getCommands';
import { TOKENS } from '@core/hotkey/tokens';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { type Client, createClient, type Exchange } from '@urql/core';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { filter, fromPromise, mergeMap, pipe } from 'wonka';

const fixtures = vi.hoisted(() => ({
  commands: [] as CommandWithInfo[],
  page: vi.fn(),
  client: undefined as Client | undefined,
  projectFlag: (): boolean | undefined => undefined,
}));

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'enable-projects' && fixtures.projectFlag() === true,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|viewer@macro.com',
}));
vi.mock('@core/context/quickAccess', () => ({
  exclude: () => [],
  useQuickAccess: () => ({
    useList: () => ({ items: () => [], hasMore: () => false }),
    usesRecordSelection: () => false,
    usesSearchProjection: () => false,
  }),
}));
vi.mock('@core/hotkey/getCommands', () => ({
  getActiveCommandsFromScope: (scope: string) =>
    scope === 'root' ? fixtures.commands : [],
}));
vi.mock('@core/hotkey/state', () => ({
  activeScope: () => 'root',
  hotkeyScopeTree: new Map(),
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => fixtures.client,
  mapGraphqlProperties: () => [],
}));
vi.mock('@queries/activity/push-registry', () => ({
  registerActivityRevalidator: () => () => {},
}));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return {
    queryClient: new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }),
  };
});

import { queryClient } from '@queries/client';
import type { CategoryFilter } from './types';
import { useCommandItems } from './useCommandItems';

afterEach(() => {
  cleanup();
  queryClient.clear();
  fixtures.page.mockReset();
});

it('gates Projects results and creation commands without hiding Folder', async () => {
  const [flag, setFlag] = createSignal<boolean | undefined>(undefined);
  const [category, setCategory] = createSignal<CategoryFilter>('projects');
  fixtures.projectFlag = flag;
  fixtures.commands = [
    {
      hotkeyToken: TOKENS.create.initiative,
      description: 'Create project',
      scopeId: 'root',
      scopeLevel: 0,
      hotkeyIsShadowed: false,
      runWithInputFocused: false,
    },
    {
      hotkeyToken: TOKENS.create.project,
      description: 'Create folder',
      scopeId: 'root',
      scopeLevel: 0,
      hotkeyIsShadowed: false,
      runWithInputFocused: false,
    },
  ];
  fixtures.page.mockImplementation(async (operation) => ({
    operation,
    stale: false,
    hasNext: false,
    data: {
      user: {
        id: 'viewer',
        soup: {
          nextCursor: null,
          items: [
            {
              __typename: 'GraphqlSoupInitiative',
              id: 'launch',
              displayName: 'Launch',
              metadata: { updatedAt: '2026-09-22T12:00:00Z' },
              viewerPermission: {
                __typename: 'GraphqlAccessLevelPermission',
                accessLevel: 'OWNER',
              },
              properties: [],
            },
          ],
        },
      },
    },
  }));
  const exchange: Exchange = () => (operations) =>
    pipe(
      operations,
      filter((operation) => operation.kind === 'query'),
      mergeMap((operation) => fromPromise(fixtures.page(operation)))
    );
  fixtures.client = createClient({
    url: 'http://test.invalid/graphql',
    exchanges: [exchange],
  });
  let source!: ReturnType<typeof useCommandItems>;
  render(() => {
    source = useCommandItems(() => '', category, {
      searchActive: () => true,
    });
    return (
      <div>
        {source
          .items()
          .map((item) => item.id)
          .join(',')}
      </div>
    );
  });
  expect(source.items()).toEqual([]);
  expect(fixtures.page).not.toHaveBeenCalled();
  setFlag(true);
  await waitFor(() =>
    expect(source.items().map((item) => item.id)).toEqual([
      'launch',
      'new-project',
    ])
  );
  setCategory('commands');
  expect(source.items().map((item) => item.id)).toEqual([
    'command-Create-project',
    'command-Create-folder',
  ]);
  setFlag(false);
  expect(source.items().map((item) => item.id)).toEqual([
    'command-Create-folder',
  ]);
  setCategory('projects');
  expect(source.items()).toEqual([]);
  expect(fixtures.page).toHaveBeenCalledTimes(1);
});
