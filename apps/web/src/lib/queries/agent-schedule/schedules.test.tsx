import { queryClient } from '@queries/client';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scheduledActionKeys } from './keys';
import { useSetScheduleEnabledMutation } from './schedules';

const setEnabled = vi.hoisted(() => vi.fn());
vi.mock('@service-scheduled-action/client', () => ({
  scheduledActionClient: { setEnabled },
}));
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
    queryClient.setQueryData(detailKey, { ...routine, team_id: 'team' });
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
    expect(queryClient.getQueryData(detailKey)).toEqual({
      ...routine,
      team_id: 'team',
    });
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
