import { NOOP_SPAN, type Span, Telemetry } from '@macro-inc/observability';
import { queryClient } from '@queries/client';
import type {
  RoutineTemplate,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import {
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
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [routine, other]);
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
  const settled = read?.catch(() => undefined);
  await mutation.mutateAsync({ scheduleId: 'routine' });
  expect(queryClient.getQueryData(key)).toBeNull();

  finishRead();
  await settled;
  expect(queryClient.getQueryData(key)).toBeNull();
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
