import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  ActionExecutionRecord,
  CreateScheduledAction,
  InProgressExecution,
  ScheduledAction,
  UpdateScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import { useMutation, useQuery } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { scheduledActionKeys } from './keys';

const QUERY_REFETCH_BEHAVIOR = {
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: 'always' as const,
};

function upsertSchedule(schedule: ScheduledAction) {
  queryClient.setQueryData(
    scheduledActionKeys.list.queryKey,
    (current: ScheduledAction[] | undefined) => {
      if (!current) return [schedule];

      const index = current.findIndex((item) => item.id === schedule.id);
      if (index === -1) return [schedule, ...current];

      const next = [...current];
      next[index] = schedule;
      return next;
    }
  );
}

function removeSchedule(scheduleId: string) {
  queryClient.setQueryData(
    scheduledActionKeys.list.queryKey,
    (current: ScheduledAction[] | undefined) =>
      current?.filter((item) => item.id !== scheduleId) ?? current
  );
}

function patchScheduleEnabled(scheduleId: string, enabled: boolean) {
  queryClient.setQueryData(
    scheduledActionKeys.list.queryKey,
    (current: ScheduledAction[] | undefined) =>
      current?.map((item) =>
        item.id === scheduleId ? { ...item, enabled } : item
      )
  );
}

export function useSchedulesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.list.queryKey,
    enabled: enabled(),
    queryFn: async () =>
      throwOnErr(async () => await scheduledActionClient.listSchedules()),
    placeholderData: (prev: ScheduledAction[] | undefined) => prev,
    reconcile: 'id',
    ...QUERY_REFETCH_BEHAVIOR,
  }));
}

export function useScheduleHistoryQuery(
  scheduleId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => {
    const currentScheduleId = scheduleId();

    return {
      queryKey: scheduledActionKeys.history({
        scheduleId: currentScheduleId ?? '__none__',
      }).queryKey,
      enabled: enabled() && Boolean(currentScheduleId),
      queryFn: async () =>
        throwOnErr(
          async () =>
            await scheduledActionClient.listHistory({
              scheduleId: currentScheduleId!,
            })
        ),
      placeholderData: (prev: ActionExecutionRecord[] | undefined) => prev,
      ...QUERY_REFETCH_BEHAVIOR,
    };
  });
}

export function invalidateSchedules() {
  return queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.list.queryKey,
  });
}

function _invalidateScheduleHistory(scheduleId: string) {
  return queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.history({ scheduleId }).queryKey,
  });
}

export function useCreateScheduleMutation(
  callbacks?: MutationCallbacks<ScheduledAction, Error, CreateScheduledAction>
) {
  return useMutation(() => ({
    mutationFn: async (request: CreateScheduledAction) =>
      throwOnErr(
        async () => await scheduledActionClient.createSchedule(request)
      ),
    ...withCallbacks(
      {
        onSuccess: async (schedule) => {
          upsertSchedule(schedule);
          await invalidateSchedules();
        },
      },
      callbacks
    ),
  }));
}

export function useUpdateScheduleMutation(
  callbacks?: MutationCallbacks<
    ScheduledAction,
    Error,
    { scheduleId: string; body: UpdateScheduledAction }
  >
) {
  return useMutation(() => ({
    mutationFn: async (args: {
      scheduleId: string;
      body: UpdateScheduledAction;
    }) =>
      throwOnErr(async () => await scheduledActionClient.updateSchedule(args)),
    ...withCallbacks(
      {
        onSuccess: async (schedule) => {
          upsertSchedule(schedule);
          await invalidateSchedules();
        },
      },
      callbacks
    ),
  }));
}

type ScheduleActivation = { scheduleId: string; enabled: boolean };
type ScheduleActivationContext = { previousEnabled: boolean | undefined };

/**
 * Patches and rolls back only the row's `enabled` flag, so a failed toggle
 * cannot undo an autosave or claim update that reached the same row meanwhile.
 */
export function useSetScheduleEnabledMutation(
  callbacks?: MutationCallbacks<
    ScheduledAction,
    Error,
    ScheduleActivation,
    ScheduleActivationContext
  >
) {
  return useMutation(() => ({
    mutationFn: async (args: ScheduleActivation) =>
      throwOnErr(async () => await scheduledActionClient.setEnabled(args)),
    ...withCallbacks<
      ScheduledAction,
      Error,
      ScheduleActivation,
      ScheduleActivationContext
    >(
      {
        onMutate: async ({ scheduleId, enabled }) => {
          await queryClient.cancelQueries({
            queryKey: scheduledActionKeys.list.queryKey,
          });
          const previousEnabled = queryClient
            .getQueryData<ScheduledAction[]>(scheduledActionKeys.list.queryKey)
            ?.find((item) => item.id === scheduleId)?.enabled;
          patchScheduleEnabled(scheduleId, enabled);
          return { previousEnabled };
        },
        onError: (_error, { scheduleId }, context) => {
          if (context?.previousEnabled !== undefined) {
            patchScheduleEnabled(scheduleId, context.previousEnabled);
          }
        },
        onSuccess: (schedule) => upsertSchedule(schedule),
        onSettled: () => invalidateSchedules(),
      },
      callbacks
    ),
  }));
}

function _useDeleteScheduleMutation(
  callbacks?: MutationCallbacks<
    { success: boolean },
    Error,
    { scheduleId: string }
  >
) {
  return useMutation(() => ({
    mutationFn: async ({ scheduleId }: { scheduleId: string }) =>
      throwOnErr(
        async () => await scheduledActionClient.deleteSchedule({ scheduleId })
      ),
    ...withCallbacks(
      {
        onSuccess: async (_result, variables) => {
          removeSchedule(variables.scheduleId);
          queryClient.removeQueries({
            queryKey: scheduledActionKeys.history({
              scheduleId: variables.scheduleId,
            }).queryKey,
          });
          await invalidateSchedules();
        },
      },
      callbacks
    ),
  }));
}

export function useRunScheduleNowMutation(
  callbacks?: MutationCallbacks<
    InProgressExecution,
    Error,
    { scheduleId: string }
  >
) {
  // History and claimed-state updates now arrive via the scheduled-action
  // websocket sync (src/lib/queries/agent-schedule/sync.ts). Invalidating on
  // HTTP success would race the synthetic pending row from the `started`
  // event and wipe it before the server persists the real record — so the
  // success path is intentionally a no-op here.
  return useMutation(() => ({
    mutationFn: async ({ scheduleId }: { scheduleId: string }) =>
      throwOnErr(
        async () => await scheduledActionClient.runNow({ scheduleId })
      ),
    ...withCallbacks({}, callbacks),
  }));
}
