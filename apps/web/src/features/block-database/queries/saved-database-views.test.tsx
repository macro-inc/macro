import type { View } from '@service-storage/generated/schemas/view';
import type { ViewsResponse } from '@service-storage/generated/schemas/viewsResponse';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DatabaseViewConfig,
  defaultDatabaseView,
  type SavedDatabaseViewConfig,
} from '../core/database-view';
import { databaseViewKeys } from './keys';
import { selectSavedDatabaseViews } from './saved-database-view-data';
import { useSavedDatabaseViews } from './saved-database-views';

const transport = vi.hoisted(() => ({
  getSavedViews: vi.fn(),
  patchView: vi.fn(),
  createSavedView: vi.fn(),
  deleteView: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { views: transport },
}));

const clients: QueryClient[] = [];
function setup(initial?: Partial<DatabaseViewConfig>) {
  const board: DatabaseViewConfig = {
    ...defaultDatabaseView(),
    layout: 'board',
    groupBy: 'status',
    groupOrder: ['done', 'todo'],
    sorts: [{ columnId: 'priority', direction: 'asc' }],
    search: 'saved search',
    ...initial,
  };
  const config: SavedDatabaseViewConfig = {
    kind: 'database-view',
    version: 1,
    databaseId: 'db',
    tableId: 'tickets',
    view: board,
  };
  let stored: View = {
    id: 'board',
    name: 'My board',
    config,
    createdAt: '',
    updatedAt: '',
    userId: 'user',
  };
  const response = (): ViewsResponse => ({
    excludedDefaultViews: [],
    views: [stored],
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(databaseViewKeys.saved.queryKey, response());
  transport.getSavedViews.mockImplementation(async () => ok(response()));
  const acceptPatch = (input: {
    name?: string;
    config?: SavedDatabaseViewConfig;
  }) => {
    stored = {
      ...stored,
      name: input.name ?? stored.name,
      config: input.config ?? stored.config,
    };
    return ok(undefined);
  };
  transport.patchView.mockImplementation(async (input) => acceptPatch(input));
  let source!: ReturnType<typeof useSavedDatabaseViews>;
  function Harness() {
    source = useSavedDatabaseViews(
      () => 'db',
      () => 'tickets'
    );
    return null;
  }
  render(() => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  ));
  const saveOrder = (
    boardOrder: Parameters<typeof source.save.mutateAsync>[0]['boardOrder']
  ) =>
    source.save.mutateAsync({
      id: 'board',
      name: 'Old name',
      tableId: 'tickets',
      preserveName: true,
      boardOrder: boardOrder!,
    });
  return {
    source,
    client,
    board,
    saveOrder,
    acceptPatch,
    stored: () => stored,
  };
}

afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  vi.resetAllMocks();
});

describe('saved board ordering', () => {
  it('serializes rapid card and lane saves without reverting the preceding order or saved settings', async () => {
    const { saveOrder, acceptPatch, stored, board } = setup();
    let release!: () => void;
    transport.patchView.mockImplementationOnce(async (input) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return acceptPatch(input);
    });
    const firstOrder = { todo: ['second', 'first'], done: ['third'] };
    const latestOrder = { todo: ['first', 'second'], done: ['third'] };
    const first = saveOrder({
      layout: 'board',
      groupBy: 'status',
      cardOrder: firstOrder,
      sorts: [],
    });
    await waitFor(() => expect(transport.patchView).toHaveBeenCalledTimes(1));
    const lanes = saveOrder({
      layout: 'board',
      groupBy: 'status',
      groupOrder: ['todo', 'done'],
    });
    const latest = saveOrder({
      layout: 'board',
      groupBy: 'status',
      cardOrder: latestOrder,
      sorts: [],
    });
    expect(transport.patchView).toHaveBeenCalledTimes(1);
    release();
    const results = await Promise.all([first, lanes, latest]);
    expect(results[1].view).toMatchObject({
      cardOrder: firstOrder,
      groupOrder: ['todo', 'done'],
      sorts: [],
    });
    expect(results[2]).toEqual({
      id: 'board',
      view: {
        ...board,
        groupOrder: ['todo', 'done'],
        cardOrder: latestOrder,
        sorts: [],
      },
    });
    expect(stored().name).toBe('My board');
    // Reloading validates and restores the exact order returned by storage.
    const restored = selectSavedDatabaseViews(
      JSON.parse(JSON.stringify([stored()])),
      'db',
      'tickets'
    );
    expect(restored[0].view).toEqual(results[2].view);
  });

  it('keeps the confirmed config on failed save and allows Save changes to retry the full draft', async () => {
    const { source, saveOrder, stored, client, board } = setup();
    transport.patchView.mockResolvedValueOnce(
      err([{ code: 'FAILED', message: 'Try again' }])
    );
    const cardOrder = { todo: ['second', 'first'] };
    await expect(
      saveOrder({
        layout: 'board',
        groupBy: 'status',
        cardOrder,
        sorts: [],
      })
    ).rejects.toThrow('Try again');
    expect((stored().config as SavedDatabaseViewConfig).view).toEqual(board);
    const cached = client.getQueryData<ViewsResponse>(
      databaseViewKeys.saved.queryKey
    )!;
    expect(
      selectSavedDatabaseViews(cached.views, 'db', 'tickets')[0].view
    ).toEqual(board);
    const draft = { ...board, cardOrder, sorts: [] };
    await source.save.mutateAsync({
      id: 'board',
      name: 'My board',
      view: draft,
    });
    expect((stored().config as SavedDatabaseViewConfig).view).toEqual(draft);
  });

  it('persists a rollback to absent manual order and restores the original sort', async () => {
    const { saveOrder, stored, board } = setup();
    await saveOrder({
      layout: 'board',
      groupBy: 'status',
      cardOrder: { todo: ['second', 'first'] },
      sorts: [],
    });
    await saveOrder({
      layout: 'board',
      groupBy: 'status',
      cardOrder: undefined,
      sorts: board.sorts,
    });
    const reloaded = JSON.parse(
      JSON.stringify(stored().config)
    ) as SavedDatabaseViewConfig;
    expect(reloaded.view.cardOrder).toBeUndefined();
    expect(reloaded.view.sorts).toEqual(board.sorts);
  });

  it('clears ordering from the previous grouping without dropping saved filters', async () => {
    const { saveOrder, stored, board } = setup({
      cardOrder: { todo: ['first'] },
    });
    await saveOrder({
      layout: 'board',
      groupBy: 'priority',
      groupOrder: ['high', 'low'],
    });
    expect((stored().config as SavedDatabaseViewConfig).view).toEqual({
      ...board,
      groupBy: 'priority',
      groupOrder: ['high', 'low'],
      cardOrder: undefined,
    });
  });
});
