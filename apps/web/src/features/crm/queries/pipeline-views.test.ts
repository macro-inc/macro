import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import type { TableDetail } from '@service-storage/generated/schemas/tableDetail';
import { QueryClient } from '@tanstack/solid-query';
import { errAsync, okAsync } from 'neverthrow';
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
