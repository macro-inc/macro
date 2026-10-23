import { queryClient } from '@queries/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import {
  useCreateScheduleMutation,
  useRunScheduleNowMutation,
  useSetScheduleEnabledMutation,
} from './schedules';

const setEnabled = vi.hoisted(() => vi.fn());
const createSchedule = vi.hoisted(() => vi.fn());
const runNow = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { setEnabled, createSchedule, runNow },
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
  task: {},
  trigger: { type: 'cron', schedule: '0 0 9 * * *', timezone: 'UTC' },
  configuration_revision: 1,
  enabled: true,
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
  track.mockReset();
  queryClient.setQueryData(scheduledActionKeys.list.queryKey, [routine, other]);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  queryClient.clear();
});

describe('routine activation', () => {
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

    await mutations.create.mutateAsync(request);
    await mutations.duplicate.mutateAsync(request);
    createSchedule.mockResolvedValueOnce(err([{ message: 'Invalid' }]));
    await expect(mutations.create.mutateAsync(request)).rejects.toBeDefined();

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
