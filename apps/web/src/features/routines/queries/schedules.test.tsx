import { queryClient } from '@queries/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import {
  useCodeUpgradesQuery,
  useCreateScheduleMutation,
  useRunScheduleNowMutation,
  useSetScheduleEnabledMutation,
} from './schedules';

const setEnabled = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const runNow = vi.hoisted(() => vi.fn());
const listCodeUpgrades = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: {
    setEnabled,
    createSchedule,
    runNow,
    listCodeUpgrades,
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
  setEnabled.mockReset();
  createSchedule.mockReset();
  runNow.mockReset();
  listCodeUpgrades.mockReset();
  track.mockReset();
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [routine, other]);
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
