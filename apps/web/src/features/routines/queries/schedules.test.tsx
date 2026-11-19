import { NOOP_SPAN, type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  RoutineTemplate,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { isCancelledError, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import {
  fetchChildren,
  useChildrenQuery,
  useCodeUpgradesQuery,
  useCreateScheduleMutation,
  useDetachScheduleMutation,
  useRunScheduleNowMutation,
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
  useSubRoutinesQuery,
} from './schedules';
import {
  useRoutineTemplateQuery,
  useUnshareTemplateMutation,
} from './templates';
import './sync';

const setEnabled = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const runNow = vi.hoisted(() => vi.fn());
const listCodeUpgrades = vi.hoisted(() => vi.fn());
const detach = vi.hoisted(() => vi.fn());
const listSchedules = vi.hoisted(() => vi.fn());
const listSubRoutines = vi.hoisted(() => vi.fn());
const listChildren = vi.hoisted(() => vi.fn());
const getTemplate = vi.hoisted(() => vi.fn());
const unshareTemplate = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
const subscribe = vi.hoisted(() =>
  vi.fn<(receive: (message: { type: string; data: unknown }) => void) => void>()
);
vi.mock('@service-connection/websocket', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@service-connection/websocket')>()),
  createConnectionWebsocketEffect: subscribe,
}));
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    setEnabled,
    createSchedule,
    runNow,
    listCodeUpgrades,
    detach,
    listSchedules,
    listSubRoutines,
    listChildren,
    getTemplate,
    unshareTemplate,
  },
}));
vi.mock('@app/lib/analytics', () => ({ analytics: { track } }));
vi.mock('@queries/client', async () => {
  const { QueryClient } = await import('@tanstack/solid-query');
  return { queryClient: new QueryClient() };
});

const runUpdateListeners = subscribe.mock.calls.map(([receive]) => receive);

const routine: ScheduledAction = {
  id: 'routine',
  owner: 'macro|owner@example.com',
  name: 'Routine',
  kind: 'Agent',
  task: { steps: [] },
  trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
  configuration_revision: 1,
  enabled: true,
  run_visibility: 'unlisted',
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z',
  next_run_at: '2026-09-29T09:00:00Z',
};
const other: ScheduledAction = { ...routine, id: 'other', name: 'Other' };

let dispose: (() => void) | undefined;

function mountMutation() {
  let mutation!: ReturnType<typeof useSetScheduleEnabledMutation>;
  function Probe() {
    mutation = useSetScheduleEnabledMutation();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  return mutation;
}

function respondLater(): (result: unknown) => void {
  let respond!: (result: unknown) => void;
  setEnabled.mockReturnValueOnce(
    new Promise((resolve) => {
      respond = resolve;
    })
  );
  return respond;
}

function schedules(): ScheduledAction[] | undefined {
  return queryClient.getQueryData(scheduledActionKeys.list.queryKey);
}

function notifyRun(type: 'started' | 'stopped') {
  for (const receive of runUpdateListeners) {
    receive({
      type: 'scheduled_action_update',
      data: { type, action_id: routine.id },
    });
  }
}

beforeEach(() => {
  getTemplate.mockReset();
  unshareTemplate.mockReset();
  setEnabled.mockReset();
  createSchedule.mockReset();
  runNow.mockReset();
  listCodeUpgrades.mockReset();
  detach.mockReset();
  listSchedules.mockReset();
  listSubRoutines.mockReset();
  listChildren.mockReset();
  track.mockReset();
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
    { ...routine },
    { ...other },
  ]);
});

it.each([
  [scheduledActionKeys.list.queryKey, listSchedules, useSchedulesQuery],
  [
    scheduledActionKeys.subRoutines.queryKey,
    listSubRoutines,
    useSubRoutinesQuery,
  ],
] as const)(
  'preserves a start claim through an older list response for %j',
  async (key, list, useList) => {
    const response = Promise.withResolvers<unknown>();
    list.mockReturnValueOnce(response.promise);
    function Probe() {
      useList(() => true);
      return null;
    }
    dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    expect(list).toHaveBeenCalledOnce();
    const read = queryClient.getQueryCache().find({ queryKey: key })?.promise;
    notifyRun('started');
    response.resolve(ok([{ ...routine }, { ...other }]));
    const rows = await read;
    expect(rows).toEqual([{ ...routine, claimed: expect.any(String) }, other]);
    expect(queryClient.getQueryData(key)).toEqual(rows);

    list.mockResolvedValueOnce(ok([{ ...routine }, { ...other }]));
    await queryClient.refetchQueries({ queryKey: key, exact: true });
    expect(queryClient.getQueryData(key)).toEqual([routine, other]);
  }
);

it('counts for Delete the children a run made after a read already in flight', async () => {
  const key = scheduledActionKeys.children({ scheduleId: 'parent' }).queryKey;
  const old = { ...routine, claimed: '2026-09-28T12:00:00Z' };
  queryClient.setQueryData(key, [{ ...old }]);
  const response = Promise.withResolvers<unknown>();
  const refreshed = Promise.withResolvers<void>();
  listChildren.mockReturnValueOnce(response.promise);
  listChildren.mockImplementationOnce(async () => {
    refreshed.resolve();
    return ok([{ ...routine }, { ...other }]);
  });
  function Probe() {
    useChildrenQuery(
      () => 'parent',
      () => true
    );
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  expect(listChildren).toHaveBeenCalledOnce();
  const read = fetchChildren('parent');
  notifyRun('started');
  notifyRun('stopped');
  // This read started before the run made its second child.
  response.resolve(ok([{ ...old }]));

  const result = await read;
  expect(result).toEqual(ok([routine, other]));
  await refreshed.promise;
  expect(listChildren).toHaveBeenCalledTimes(2);
});

it('reads children again for Delete after a read already in flight', async () => {
  const key = scheduledActionKeys.children({ scheduleId: 'parent' }).queryKey;
  queryClient.setQueryData(key, [{ ...routine }]);
  const response = Promise.withResolvers<unknown>();
  listChildren.mockReturnValueOnce(response.promise);
  listChildren.mockResolvedValueOnce(ok([{ ...routine }, { ...other }]));
  function Probe() {
    useChildrenQuery(
      () => 'parent',
      () => true
    );
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  expect(listChildren).toHaveBeenCalledOnce();

  const read = fetchChildren('parent');
  response.resolve(ok([{ ...routine }]));

  expect(await read).toEqual(ok([routine, other]));
  expect(listChildren).toHaveBeenCalledTimes(2);
});

it('keeps sharing revoked when an older status response arrives after DELETE', async () => {
  const template: RoutineTemplate = {
    id: 'routine',
    author: routine.owner,
    name: routine.name,
    description: '',
    active_count: 0,
    created_at: routine.created_at,
    updated_at: routine.updated_at,
    appearance: {},
    task: routine.task,
    trigger: routine.trigger,
    variables: [],
  };
  const key = scheduledActionKeys.template({ scheduleId: 'routine' }).queryKey;
  queryClient.setQueryData(key, template);
  let finishRead!: () => void;
  const oldResponse = new Promise((resolve) => {
    finishRead = () => resolve(ok(template));
  });
  getTemplate.mockReturnValue(oldResponse);
  unshareTemplate.mockResolvedValue(ok(undefined));
  let mutation!: ReturnType<typeof useUnshareTemplateMutation>;
  function Probe() {
    useRoutineTemplateQuery(() => 'routine');
    mutation = useUnshareTemplateMutation();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );

  await vi.waitFor(() => expect(getTemplate).toHaveBeenCalledOnce());
  const read = queryClient.getQueryCache().find({ queryKey: key })?.promise;
  async function readError() {
    try {
      await read;
    } catch (error) {
      return error;
    }
  }
  const settled = readError();
  await mutation.mutateAsync({ scheduleId: 'routine' });
  expect(queryClient.getQueryData(key)).toBeNull();

  finishRead();
  expect(isCancelledError(await settled)).toBe(true);
  expect(queryClient.getQueryData(key)).toBeNull();
});

it('reuses fresh sharing status and traces both attempts after it expires', async () => {
  const { readRoutineTemplateStatus } = await import('./templates');
  queryClient.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
  const key = scheduledActionKeys.template({ scheduleId: 'routine' }).queryKey;
  const contexts: boolean[] = [];
  let active = false;
  const parent = {
    run<T>(work: () => T): T {
      active = true;
      try {
        return work();
      } finally {
        active = false;
      }
    },
  };
  queryClient.setQueryData(key, null, { updatedAt: Date.now() - 4 * 60_000 });
  expect(await readRoutineTemplateStatus('routine', parent)).toBeNull();
  expect(getTemplate).not.toHaveBeenCalled();

  queryClient.setQueryData(key, null, { updatedAt: Date.now() - 6 * 60_000 });
  getTemplate
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return err([{ message: 'Try again' }]);
    })
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return err([{ code: 'NOT_FOUND' }]);
    });
  expect(await readRoutineTemplateStatus('routine', parent)).toBeNull();
  expect(contexts).toEqual([true, true]);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
  queryClient.setDefaultOptions({});
});

it('uses the approval trace context again on an actual query retry', async () => {
  queryClient.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
  let active = false;
  const parentSpan = {
    run<T>(work: () => T): T {
      active = true;
      try {
        return work();
      } finally {
        active = false;
      }
    },
  };
  const contexts: boolean[] = [];
  listCodeUpgrades
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return err([{ message: 'Temporarily unavailable' }]);
    })
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return ok([]);
    });
  let query!: ReturnType<typeof useCodeUpgradesQuery>;
  function Probe() {
    query = useCodeUpgradesQuery(
      () => 'routine',
      () => false
    );
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  const options = { throwOnError: true, parentSpan };
  await parentSpan.run(() => query.refetch(options));
  expect(contexts).toEqual([true, true]);
});

it('carries a Duplicate admission context through create and list retries', async () => {
  queryClient.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
  const contexts: boolean[] = [];
  let active = false;
  const parentSpan = {
    run<T>(work: () => T): T {
      active = true;
      try {
        return work();
      } finally {
        active = false;
      }
    },
  };
  listSchedules.mockResolvedValueOnce(ok([routine, other]));
  createSchedule.mockImplementation(async () => {
    contexts.push(active);
    return ok({ ...routine, id: 'duplicate' });
  });
  let mutation!: ReturnType<typeof useCreateScheduleMutation>;
  function Probe() {
    useSchedulesQuery(() => true);
    mutation = useCreateScheduleMutation(undefined, 'duplicate');
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
  listSchedules
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return err([{ message: 'Try again' }]);
    })
    .mockImplementationOnce(async () => {
      contexts.push(active);
      return ok([routine, other]);
    });
  const request = {
    body: {
      name: routine.name,
      kind: routine.kind,
      trigger: routine.trigger,
      task: routine.task,
      enabled: true,
    },
    parentSpan,
  };
  await mutation.mutateAsync(request);
  expect(contexts).toEqual([true, true, true]);
});

it('moves a detached copy out of both child caches when list refreshes fail', async () => {
  queryClient.setDefaultOptions({ queries: { retry: false } });
  const copy: ScheduledAction = {
    ...routine,
    id: 'copy',
    sub_routine: { parent_id: 'routine', created_by_run_id: 'run' },
    task: { sub_routine: 'remind', inputs: {} },
  };
  const sibling = { ...copy, id: 'sibling' };
  const kept = { ...routine, id: 'copy', configuration_revision: 2 };
  const detailKey = scheduledActionKeys.detail({ scheduleId: 'copy' }).queryKey;
  const childrenKey = scheduledActionKeys.children({
    scheduleId: 'routine',
  }).queryKey;
  const activeKey = scheduledActionKeys.subRoutines.queryKey;
  queryClient.setQueryData(detailKey, copy);
  listSchedules.mockResolvedValue(ok([routine, other]));
  listSubRoutines.mockResolvedValue(ok([copy, sibling]));
  listChildren.mockResolvedValue(ok([copy, sibling]));
  detach.mockResolvedValue(ok(kept));

  let mutation!: ReturnType<typeof useDetachScheduleMutation>;
  function Probe() {
    useSchedulesQuery(() => true);
    useSubRoutinesQuery(() => true);
    useChildrenQuery(
      () => 'routine',
      () => true
    );
    mutation = useDetachScheduleMutation();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  await vi.waitFor(() =>
    expect(queryClient.getQueryData(childrenKey)).toEqual([copy, sibling])
  );
  for (const read of [listSchedules, listSubRoutines, listChildren])
    read.mockResolvedValue(err([{ message: 'List unavailable' }]));
  await mutation.mutateAsync({ scheduleId: 'copy' });

  expect(queryClient.getQueryState(childrenKey)?.status).toBe('error');
  expect(queryClient.getQueryData(childrenKey)).toEqual([sibling]);
  expect(queryClient.getQueryData(activeKey)).toEqual([sibling]);
  expect(queryClient.getQueryData(detailKey)).toEqual(kept);
  expect(schedules()).toEqual([kept, routine, other]);
});

it('keeps detach open and parents both attempts of a child refresh', async () => {
  queryClient.setDefaultOptions({ queries: { retry: 1, retryDelay: 0 } });
  const active: boolean[] = [];
  let inDetach = false;
  const end = vi.fn();
  const span: Span = {
    span: NOOP_SPAN.span,
    error: NOOP_SPAN.error,
    event: NOOP_SPAN.event,
    setAttr: NOOP_SPAN.setAttr,
    traceparent: NOOP_SPAN.traceparent,
    injectTraceHeaders: NOOP_SPAN.injectTraceHeaders,
    end,
    run<T>(work: () => T): T {
      const previous = inDetach;
      inDetach = true;
      try {
        return work();
      } finally {
        inDetach = previous;
      }
    },
  };
  const start = vi.spyOn(Telemetry, 'span').mockReturnValue(span);
  const childKey = scheduledActionKeys.subRoutines.queryKey;
  listSubRoutines.mockResolvedValueOnce(ok([other]));
  detach.mockResolvedValue(ok(routine));
  let mutation!: ReturnType<typeof useDetachScheduleMutation>;
  function Probe() {
    useSubRoutinesQuery(() => true);
    mutation = useDetachScheduleMutation();
    return null;
  }
  dispose = render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    ),
    document.createElement('div')
  );
  try {
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(childKey)).toEqual([other])
    );
    let finishRefresh!: () => void;
    const response = new Promise((resolve) => {
      finishRefresh = () => resolve(ok([other]));
    });
    listSubRoutines
      .mockImplementationOnce(async () => {
        active.push(inDetach);
        return err([{ message: 'Try again' }]);
      })
      .mockImplementationOnce(() => {
        active.push(inDetach);
        return response;
      });
    const keeping = mutation.mutateAsync({ scheduleId: 'routine' });
    try {
      await vi.waitFor(() => expect(active).toHaveLength(2));
      expect(active).toEqual([true, true]);
      expect(end).not.toHaveBeenCalled();
    } finally {
      finishRefresh();
      await keeping;
    }
    expect(end).toHaveBeenCalledOnce();
  } finally {
    start.mockRestore();
  }
});

describe('routine activation', () => {
  it('keeps an updated copy in the child cache if the top-level list refresh fails', async () => {
    const child: ScheduledAction = {
      ...routine,
      id: 'copy',
      sub_routine: { parent_id: 'routine', created_by_run_id: 'run' },
      task: { sub_routine: 'remind', inputs: {} },
    };
    const childKey = scheduledActionKeys.subRoutines.queryKey;
    const saved = { ...child, enabled: false, configuration_revision: 2 };
    queryClient.setQueryData(childKey, [child]);
    setEnabled.mockResolvedValue(ok(saved));
    // Put the in-flight list read into an error state with retained data.
    await expect(
      queryClient.fetchQuery({
        queryKey: scheduledActionKeys.list.queryKey,
        staleTime: 0,
        retry: false,
        queryFn: async () => {
          throw new Error('List unavailable');
        },
      })
    ).rejects.toThrow('List unavailable');

    await mountMutation().mutateAsync({ scheduleId: 'copy', enabled: false });
    expect(schedules()).toEqual([routine, other]);
    expect(queryClient.getQueryData(childKey)).toEqual([saved]);
  });

  it('pauses only the target routine while saving, then keeps the saved row', async () => {
    const respond = respondLater();
    const pausing = mountMutation().mutateAsync({
      scheduleId: 'routine',
      enabled: false,
    });
    await vi.waitFor(() =>
      expect(schedules()).toEqual([{ ...routine, enabled: false }, other])
    );
    const saved = {
      ...routine,
      enabled: false,
      configuration_revision: 2,
      updated_at: '2026-09-28T12:00:00Z',
    };
    respond(ok(saved));
    await pausing;
    expect(setEnabled).toHaveBeenCalledExactlyOnceWith({
      scheduleId: 'routine',
      enabled: false,
    });
    expect(schedules()).toEqual([saved, other]);
  });

  it('rolls back activation from a detail-only cache after an error', async () => {
    queryClient.removeQueries({ queryKey: scheduledActionKeys.list.queryKey });
    const detailKey = scheduledActionKeys.detail({
      scheduleId: 'routine',
    }).queryKey;
    queryClient.setQueryData(detailKey, routine);
    const respond = respondLater();
    const pausing = mountMutation().mutateAsync({
      scheduleId: 'routine',
      enabled: false,
    });
    await vi.waitFor(() =>
      expect(
        queryClient.getQueryData<ScheduledAction>(detailKey)?.enabled
      ).toBe(false)
    );
    respond(err([{ code: 'CONFLICT', message: 'Routine changed' }]));
    await expect(pausing).rejects.toThrow('Routine changed');
    expect(queryClient.getQueryData(detailKey)).toEqual(routine);
  });

  it('restores only the activation it changed when saving fails', async () => {
    const respond = respondLater();
    const pausing = mountMutation().mutateAsync({
      scheduleId: 'routine',
      enabled: false,
    });
    await vi.waitFor(() => expect(schedules()?.[0].enabled).toBe(false));
    const claimed = '2026-09-28T12:00:00Z';
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [
      { ...routine, enabled: false, claimed },
      other,
    ]);
    respond(err([{ code: 'CONFLICT', message: 'Routine changed' }]));
    await expect(pausing).rejects.toThrow('Routine changed');
    expect(schedules()).toEqual([{ ...routine, claimed }, other]);
  });
});

describe('routine analytics', () => {
  const agentRoutine: ScheduledAction = {
    ...routine,
    task: {
      agent: { bot_id: '01a15c48-43af-7050-9059-8c5e46d6d7d7' },
      prompt: '',
      user_prompt: 'Post the daily metrics',
    },
  };

  const request = {
    name: agentRoutine.name,
    kind: agentRoutine.kind,
    task: agentRoutine.task,
    trigger: agentRoutine.trigger,
    enabled: true,
  };

  function mountRoutineMutations() {
    let mutations!: {
      create: ReturnType<typeof useCreateScheduleMutation>;
      duplicate: ReturnType<typeof useCreateScheduleMutation>;
      run: ReturnType<typeof useRunScheduleNowMutation>;
    };
    function Probe() {
      mutations = {
        create: useCreateScheduleMutation(),
        duplicate: useCreateScheduleMutation(undefined, 'duplicate'),
        run: useRunScheduleNowMutation(),
      };
      return null;
    }
    dispose = render(
      () => (
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>
      ),
      document.createElement('div')
    );
    return mutations;
  }

  it('reports created and duplicated routines, but not failed ones', async () => {
    createSchedule.mockResolvedValue(ok(agentRoutine));
    const mutations = mountRoutineMutations();

    await mutations.create.mutateAsync({ body: request });
    await mutations.duplicate.mutateAsync({ body: request });
    createSchedule.mockResolvedValueOnce(err([{ message: 'Invalid' }]));
    await expect(
      mutations.create.mutateAsync({ body: request })
    ).rejects.toBeDefined();

    expect(track.mock.calls).toEqual([
      [
        'routine_created',
        {
          routineId: 'routine',
          source: 'new',
          triggerType: 'cron',
          targetKind: 'agent',
        },
      ],
      [
        'routine_created',
        expect.objectContaining({ routineId: 'routine', source: 'duplicate' }),
      ],
    ]);
  });

  it('reports an accepted manual run with the target kind from the list cache', async () => {
    queryClient.setQueryData(scheduledActionKeys.list.queryKey, [agentRoutine]);
    runNow.mockResolvedValue(ok({}));
    const mutations = mountRoutineMutations();

    await mutations.run.mutateAsync({ scheduleId: 'routine' });
    runNow.mockResolvedValueOnce(err([{ message: 'Busy' }]));
    await expect(
      mutations.run.mutateAsync({ scheduleId: 'routine' })
    ).rejects.toBeDefined();

    expect(track).toHaveBeenCalledExactlyOnceWith('routine_run', {
      routineId: 'routine',
      trigger: 'manual',
      targetKind: 'agent',
    });
  });
});
