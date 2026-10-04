import { buildTaskQuery } from '@app/features/tasks-view/queries/task-query';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { soupKeys } from '@queries/soup/keys';
import { QueryClient } from '@tanstack/solid-query';
import { ok } from 'neverthrow';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createProjectTaskMutation } from './create-project-task';
import { projectKeys } from './keys';

const mock = vi.hoisted(() => ({ create: vi.fn(), failure: vi.fn() }));
vi.mock('@block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: mock.create,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mock.failure },
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

it.each(['saved', 'failed', 'assignment-failed'] as const)(
  'inserts before closing or contacting the server and handles %s',
  async (outcome) => {
    const cache = new QueryClient();
    const detailKey = projectKeys.detail('viewer', 'project').queryKey;
    cache.setQueryData(detailKey, { project: { taskIds: [] }, properties: [] });
    const args = (taskIds: string[]) =>
      buildTaskQuery({
        tab: 'team-tasks',
        userId: 'viewer',
        taskIds,
        groupBy: 'none',
        facets: {},
        sort: [],
      });
    cache.setQueryData(soupKeys.astItems(args([])).queryKey, {
      pages: [{ kind: 'flat', items: [], nextCursor: null }],
      pageParams: [null],
    });
    let complete!: (
      result: { documentId: string; initialSnapshot: undefined } | null
    ) => void;
    mock.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const assignTasks = vi.fn(async () =>
      ok({
        results: [
          {
            taskId: 'saved',
            status:
              outcome === 'assignment-failed'
                ? ('skippedNoPermission' as const)
                : ('assigned' as const),
          },
        ],
      })
    );
    const refresh = vi.fn(async () => {});
    let dispose!: () => void;
    const create = createRoot((d) => {
      dispose = d;
      return createProjectTaskMutation(
        { assignTasks },
        () => undefined,
        cache,
        () => 'viewer',
        refresh
      );
    });
    const onMutate = vi.fn(() => {
      const ids = cache.getQueryData<{ project: { taskIds: string[] } }>(
        detailKey
      )!.project.taskIds;
      const data = cache.getQueryData<{
        pages: { items: { tag: string; data: { name: string } }[] }[];
      }>(soupKeys.astItems(args(ids)).queryKey)!;
      expect(data.pages[0].items[0]).toMatchObject({
        tag: 'document',
        data: { name: 'Created task' },
      });
      expect(mock.create).not.toHaveBeenCalled();
    });
    try {
      const saving = create(
        'project',
        'Created task',
        '',
        [],
        new Map(),
        vi.fn(),
        { onMutate, shareWithTeam: false }
      );
      await vi.waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
      expect(mock.create).toHaveBeenCalledWith(
        'Created task',
        '',
        [],
        new Map(),
        expect.any(Function),
        { revalidateSoup: false, shareWithTeam: false }
      );
      expect(onMutate).toHaveBeenCalledOnce();
      expect(assignTasks).not.toHaveBeenCalled();
      complete(
        outcome === 'failed'
          ? null
          : { documentId: 'saved', initialSnapshot: undefined }
      );
      const result = await saving;
      const ids = cache.getQueryData<{ project: { taskIds: string[] } }>(
        detailKey
      )!.project.taskIds;
      expect(ids).toEqual(outcome === 'saved' ? ['saved'] : []);
      expect(result?.documentId).toBe(
        outcome === 'failed' ? undefined : 'saved'
      );
      if (outcome === 'assignment-failed')
        expect(mock.failure).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      dispose();
      cache.clear();
    }
  }
);

it.each(['viewer', 'host', 'reset'] as const)(
  'ignores a deferred task completion after the %s changes',
  async (change) => {
    const cache = new QueryClient();
    cache.setQueryData(projectKeys.detail('viewer', 'project').queryKey, {
      project: { taskIds: [] },
      properties: [],
    });
    let reset!: Parameters<CacheHost['onCacheGenerationChanged']>[0];
    const unsubscribe = vi.fn();
    const host: CacheHost = {
      ...createNoopCacheHost(),
      disabled: false,
      onCacheGenerationChanged: (callback) => {
        reset = callback;
        return unsubscribe;
      },
    };
    const write = vi.spyOn(host, 'writeQuery');
    const replacement = createNoopCacheHost();
    const replacementWrite = vi.spyOn(replacement, 'writeQuery');
    const [viewer, setViewer] = createSignal('viewer');
    const [currentHost, setHost] = createSignal(host);
    let complete!: (value: {
      documentId: string;
      initialSnapshot: undefined;
    }) => void;
    mock.create.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        })
    );
    const assignTasks = vi.fn(async () =>
      ok({ results: [{ taskId: 'saved', status: 'assigned' as const }] })
    );
    const refresh = vi.fn(async () => {});
    let dispose!: () => void;
    const create = createRoot((cleanup) => {
      dispose = cleanup;
      return createProjectTaskMutation(
        { assignTasks },
        currentHost,
        cache,
        viewer,
        refresh
      );
    });
    try {
      const pending = create('project', 'New task', '', [], new Map(), vi.fn());
      await vi.waitFor(() => expect(mock.create).toHaveBeenCalledOnce());
      const before = write.mock.calls.length;
      if (change === 'viewer') setViewer('replacement-viewer');
      if (change === 'host') setHost(replacement);
      if (change === 'reset') reset({ storage: 'reset' });
      cache.clear();
      complete({ documentId: 'saved', initialSnapshot: undefined });
      expect(await pending).toBeNull();
      expect(write).toHaveBeenCalledTimes(before);
      expect(replacementWrite).not.toHaveBeenCalled();
      expect(assignTasks).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(unsubscribe).toHaveBeenCalledOnce();
      expect(cache.getQueryCache().getAll()).toHaveLength(0);
    } finally {
      dispose();
      cache.clear();
    }
  }
);
