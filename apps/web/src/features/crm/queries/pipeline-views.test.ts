import type { AppliedOps } from '@service-storage/generated/schemas/appliedOps';
import type { CardPosition } from '@service-storage/generated/schemas/cardPosition';
import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { QueryClient } from '@tanstack/solid-query';
import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { afterEach, expect, it, vi } from 'vitest';
import { allRecordsView } from '../../database/core/views';
import type { Pipeline } from '../core/pipeline';
import type { CrmRecordDependencies } from './dependencies';
import { crmKeys } from './keys';
import { createPipelineViews } from './pipeline-views';

const pipeline: Pipeline = {
  id: 'pipeline',
  databaseId: 'storage-only',
  tableId: 'records',
  primaryColumnId: 'company',
  name: 'Sales',
  userId: 'macro|owner@example.com',
  teamId: 'team',
  recordType: 'company',
  sharing: 'team',
  grant: 'owner',
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
};
const allRecords = allRecordsView({
  id: 'records',
  database_id: 'storage-only',
});
const stored = (overrides: Partial<DatabaseView> = {}): DatabaseView => ({
  ...allRecords,
  id: 'view',
  name: 'Table view',
  position: 'a0',
  ...overrides,
});
const clients: QueryClient[] = [];
it('settles positions in the originating board cache without a stale refetch overwriting them', async () => {
  const { client, views, applyCrmPipelineOps } = setup();
  const first = {
    row: 'first',
    lane: { kind: 'none' as const },
    position: '40',
  };
  const moved = {
    row: 'second',
    lane: { kind: 'none' as const },
    position: '80',
  };
  client.setQueryData(crmKeys.pipelinePositions('pipeline', 'view').queryKey, [
    first,
  ]);
  client.setQueryData(
    crmKeys.pipelinePositions('pipeline', 'other').queryKey,
    []
  );
  const write = Promise.withResolvers<AppliedOps>();
  applyCrmPipelineOps.mockReturnValue(
    ResultAsync.fromSafePromise(write.promise)
  );
  const moving = views.moveCard(stored(), {
    row: 'second',
    lane: { kind: 'none' },
    before: 'first',
    after: null,
  });
  await vi.waitFor(() => expect(applyCrmPipelineOps).toHaveBeenCalled());
  const read = Promise.withResolvers<CardPosition[]>();
  const refetch = client
    .fetchQuery({
      queryKey: crmKeys.pipelinePositions('pipeline', 'view').queryKey,
      queryFn: () => read.promise,
    })
    .catch(() => undefined);
  write.resolve({
    results: [
      {
        kind: 'view',
        table: 'records',
        view: 'view',
        tableVersion: 2,
        change: { kind: 'card_moved', positions: [moved] },
      },
    ],
    changes: [],
  });
  await moving;
  read.resolve([first]);
  await refetch;
  expect(
    client.getQueryData(crmKeys.pipelinePositions('pipeline', 'view').queryKey)
  ).toEqual([first, moved]);
  expect(
    client.getQueryData(crmKeys.pipelinePositions('pipeline', 'other').queryKey)
  ).toEqual([]);
});

it('keeps the saved lane and order when a card move is refused', async () => {
  const { client, views, applyCrmPipelineOps } = setup();
  const key = crmKeys.pipelinePositions(pipeline.id, 'view').queryKey;
  const saved: CardPosition[] = [
    { row: 'second', lane: { kind: 'option', id: 'lead' }, position: '40' },
    { row: 'first', lane: { kind: 'option', id: 'lead' }, position: '80' },
  ];
  client.setQueryData(key, saved);
  applyCrmPipelineOps.mockImplementation(() => {
    expect(client.getQueryData(key)).toEqual(saved);
    return errAsync([
      { code: 'INVALID_OP', message: 'Required field missing', refusal: null },
    ]);
  });

  const result = await views.moveCard(stored(), {
    row: 'second',
    lane: { kind: 'option', id: 'qualified' },
    before: null,
    after: null,
  });

  expect(result.isErr()).toBe(true);
  expect(client.getQueryData(key)).toEqual(saved);
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

function setup(views: DatabaseView[] = []) {
  const client = new QueryClient();
  clients.push(client);
  client.setQueryData(crmKeys.pipelineTable(pipeline.id).queryKey, {
    views,
  } as unknown as TableDetail);
  const applyCrmPipelineOps = vi.fn();
  const deps = {
    client,
    storage: { applyCrmPipelineOps },
  } as unknown as CrmRecordDependencies;
  const cached = () =>
    client.getQueryData<TableDetail>(
      crmKeys.pipelineTable(pipeline.id).queryKey
    )?.views;
  return {
    client,
    applyCrmPipelineOps,
    cached,
    views: createPipelineViews(deps, pipeline),
  };
}

const answered = (view: DatabaseView, change: 'created' | 'updated') =>
  okAsync({
    results: [
      {
        kind: 'view',
        table: 'records',
        view: view.id,
        change: { kind: change, view },
      },
    ],
    changes: [],
  });

it('creates a view on the pipeline table through the pipeline endpoint', async () => {
  const { views, applyCrmPipelineOps, cached } = setup();
  const created = stored();
  applyCrmPipelineOps.mockReturnValue(answered(created, 'created'));
  const result = await views.create(
    allRecords,
    { name: 'Table view', layout: 'table' },
    []
  );
  expect(result.isOk()).toBe(true);
  expect(applyCrmPipelineOps).toHaveBeenCalledWith('pipeline', {
    ops: [
      {
        kind: 'view',
        table: 'records',
        view: expect.any(String),
        change: {
          kind: 'create',
          view: {
            name: 'Table view',
            query: allRecords.query,
            layout: { kind: 'table', columns: [] },
          },
        },
      },
    ],
  });
  expect(cached()).toEqual([created]);
});

it('adds a Status column and its board in one batch when nothing can group', async () => {
  const { views, applyCrmPipelineOps } = setup();
  applyCrmPipelineOps.mockReturnValue(answered(stored(), 'created'));
  await views.create(
    allRecords,
    { name: 'Board view', layout: 'board', groupBy: { kind: 'new-status' } },
    []
  );
  const [, { ops }] = applyCrmPipelineOps.mock.calls[0];
  expect(ops.map((op: { kind: string }) => op.kind)).toEqual([
    'column',
    'view',
  ]);
});

it('shows a change ahead of the answer and reloads what is stored when refused', async () => {
  const view = stored();
  const { client, views, applyCrmPipelineOps, cached } = setup([view]);
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  applyCrmPipelineOps.mockImplementation(() => {
    expect(cached()?.[0]?.name).toBe('Renamed');
    return errAsync([
      { code: 'INVALID_OP', message: 'Refused', refusal: null },
    ]);
  });
  const result = await views.update(view, { name: 'Renamed' });
  expect(result.isErr()).toBe(true);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: crmKeys.pipelineTable(pipeline.id).queryKey,
  });
});
