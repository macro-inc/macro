import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { storageServiceClient } from '@service-storage/client';
import type { AccessiblePipeline } from '@service-storage/generated/schemas/accessiblePipeline';
import { cleanup, render } from '@solidjs/testing-library';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PipelinesSource } from '../context/pipelines';
import { crmKeys } from './keys';
import { updatePipelineTeamShare } from './pipeline-sharing';
import { createPipelinesSource } from './pipelines';

const fixture = vi.hoisted(() => ({
  client: undefined as QueryClient | undefined,
}));
vi.mock('@queries/client', () => ({
  get queryClient() {
    return fixture.client;
  },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    listCrmPipelines: vi.fn(),
    createCrmPipeline: vi.fn(),
    renameCrmPipeline: vi.fn(),
    trashCrmPipeline: vi.fn(),
    shareCrmPipeline: vi.fn(),
  },
}));

const pipeline: AccessiblePipeline = {
  id: 'pipeline',
  teamId: 'team',
  name: 'Sales',
  userId: 'viewer',
  recordType: 'company',
  databaseId: 'database',
  tableId: 'records',
  primaryColumnId: 'company',
  sharing: 'private',
  grant: 'owner',
  commercialFields: {},
  createdAt: '2026-10-01T00:00:00Z',
  trashedAt: null,
};
const key = crmKeys.pipelines('team').queryKey;
let client: QueryClient;
let source: PipelinesSource;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  fixture.client = client;
  client.setQueryData(key, [pipeline]);
  render(() => {
    source = createPipelinesSource(
      {
        client,
        storage: storageServiceClient,
        feedback: { success: vi.fn(), failure: vi.fn() },
      },
      () => 'team'
    );
    return null;
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it.each(['create', 'rename', 'trash', 'share'] as const)(
  'refreshes current pipelines after a committed %s across retirement without applying its old response',
  async (action) => {
    const created = { ...pipeline, id: 'created', name: 'Created' };
    const fresh = [
      { ...pipeline, name: 'Current server name', sharing: 'team' as const },
    ];
    vi.mocked(storageServiceClient.listCrmPipelines).mockResolvedValue(
      ok(fresh)
    );
    const commit = Promise.withResolvers<void>();
    vi.mocked(storageServiceClient.createCrmPipeline).mockImplementation(
      async () => {
        await commit.promise;
        return ok(created);
      }
    );
    vi.mocked(storageServiceClient.renameCrmPipeline).mockImplementation(
      async () => {
        await commit.promise;
        return ok();
      }
    );
    vi.mocked(storageServiceClient.trashCrmPipeline).mockImplementation(
      async () => {
        await commit.promise;
        return ok();
      }
    );
    vi.mocked(storageServiceClient.shareCrmPipeline).mockImplementation(
      async () => {
        await commit.promise;
        return ok();
      }
    );
    const seed = vi.spyOn(client, 'setQueryData');
    const patch = vi.spyOn(client, 'setQueriesData');
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    const pending =
      action === 'create'
        ? source.create({
            name: 'Created',
            recordType: 'company',
            sharing: 'private',
          })
        : action === 'rename'
          ? source.rename(pipeline.id, 'Submitted name')
          : action === 'trash'
            ? source.trash(pipeline.id)
            : updatePipelineTeamShare(pipeline.id, true);

    await cacheSessionGeneration.transition(async () => {});
    commit.resolve();
    const result = await pending;
    if (action === 'create') expect(result).toEqual(created);
    expect(storageServiceClient.listCrmPipelines).toHaveBeenCalledOnce();
    await Promise.all(invalidation.mock.results.map((result) => result.value));
    expect(seed).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(fresh);
  }
);
