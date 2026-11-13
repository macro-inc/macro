import { removeAcceptedSuggestion } from '@app/features/routine-suggestions/queries/routine-suggestions';
import { analytics } from '@app/lib/analytics';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { type MutationCallbacks, withCallbacks } from '@queries/utils';
import { scheduledActionClient } from '@service-scheduled-action/client';
import type {
  ActionConfiguration,
  ActionConfigurationUpdate,
  InProgressExecution,
  ScheduledAction,
} from '@service-scheduled-action/generated/schemas';
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { scheduledActionKeys } from './keys';
import { routineTargetKind } from './routine-draft';

const QUERY_REFETCH_BEHAVIOR = {
  refetchOnMount: 'always' as const,
  refetchOnWindowFocus: 'always' as const,
};

function upsertSchedule(schedule: ScheduledAction) {
  if (schedule.id)
    queryClient.setQueryData(
      scheduledActionKeys.detail({ scheduleId: schedule.id }).queryKey,
      (current: ScheduledAction | undefined) =>
        current ? { ...current, ...schedule } : undefined
    );

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
    scheduledActionKeys.detail({ scheduleId }).queryKey,
    (current: ScheduledAction | undefined) =>
      current ? { ...current, enabled } : undefined
  );

  for (const key of [
    scheduledActionKeys.list.queryKey,
    scheduledActionKeys.subRoutines.queryKey,
  ])
    queryClient.setQueryData(key, (current: ScheduledAction[] | undefined) =>
      current?.map((item) =>
        item.id === scheduleId ? { ...item, enabled } : item
      )
    );
}

function fetchSchedules() {
  return throwOnErr(async () => await scheduledActionClient.listSchedules());
}

export function useSchedulesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.list.queryKey,
    enabled: enabled(),
    queryFn: fetchSchedules,
    placeholderData: keepPreviousData,
    reconcile: 'id',
    ...QUERY_REFETCH_BEHAVIOR,
  }));
}

// Cached past unmount; closes over the resolved schedule id only.
function scheduleHistoryQueryOptions(
  scheduleId: string | null | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: scheduledActionKeys.history({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: async () =>
      throwOnErr(
        async () =>
          await scheduledActionClient.listHistory({ scheduleId: scheduleId! })
      ),
    ...QUERY_REFETCH_BEHAVIOR,
  });
}

export function useScheduleHistoryQuery(
  scheduleId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => scheduleHistoryQueryOptions(scheduleId(), enabled()));
}

// Cached past unmount; closes over the resolved schedule id only.
function codeUpgradesQueryOptions(
  scheduleId: string | null | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: scheduledActionKeys.codeUpgrades({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: async () =>
      throwOnErr(
        async () =>
          await scheduledActionClient.listCodeUpgrades({
            scheduleId: scheduleId!,
          })
      ),
    ...QUERY_REFETCH_BEHAVIOR,
  });
}

/** How the routine's code steps were brought to new SDKs, newest first. */
export function useCodeUpgradesQuery(
  scheduleId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => codeUpgradesQueryOptions(scheduleId(), enabled()));
}

function fetchSubRoutines() {
  return throwOnErr(async () => await scheduledActionClient.listSubRoutines());
}

// Cached past unmount; closes over the resolved routine id only.
function childrenQueryOptions(scheduleId: string, enabled: boolean) {
  return queryOptions({
    queryKey: scheduledActionKeys.children({ scheduleId }).queryKey,
    enabled,
    queryFn: async () =>
      throwOnErr(
        async () => await scheduledActionClient.listChildren({ scheduleId })
      ),
    ...QUERY_REFETCH_BEHAVIOR,
  });
}

/** What one routine's runs created, finished one-time ones included. */
export function useChildrenQuery(
  scheduleId: Accessor<string>,
  enabled: Accessor<boolean>
) {
  return useQuery(() => childrenQueryOptions(scheduleId(), enabled()));
}

/**
 * Read a routine's children now, as a delete would remove them: fresh, and
 * without a retry that would hold up the confirmation.
 */
export function fetchChildren(scheduleId: string) {
  return ResultAsync.fromPromise(
    queryClient.fetchQuery({
      ...childrenQueryOptions(scheduleId, true),
      staleTime: 0,
      retry: false,
    }),
    (error) => error
  );
}

/** Every active routine another routine's run created. */
export function useSubRoutinesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.subRoutines.queryKey,
    enabled: enabled(),
    queryFn: fetchSubRoutines,
    placeholderData: keepPreviousData,
    reconcile: 'id',
    ...QUERY_REFETCH_BEHAVIOR,
  }));
}

export function invalidateSchedules() {
  return Promise.all([
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.list.queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.subRoutines.queryKey,
    }),
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.children._def,
    }),
    queryClient.invalidateQueries({
      queryKey: scheduledActionKeys.detail._def,
    }),
  ]);
}

function _invalidateScheduleHistory(scheduleId: string) {
  return queryClient.invalidateQueries({
    queryKey: scheduledActionKeys.history({ scheduleId }).queryKey,
  });
}

/** A routine to create, and the suggestion it is saved from, if any. */
export type CreateScheduleRequest = {
  body: ActionConfiguration;
  suggestionId?: string;
};

export function useCreateScheduleMutation(
  callbacks?: MutationCallbacks<ScheduledAction, Error, CreateScheduleRequest>,
  /** Whether the user created the routine or duplicated one, for analytics. */
  source: 'new' | 'duplicate' = 'new'
) {
  return useMutation(() => ({
    mutationFn: async (request: CreateScheduleRequest) =>
      throwOnErr(
        async () =>
          await scheduledActionClient.createSchedule(request.body, {
            suggestionId: request.suggestionId,
          })
      ),
    ...withCallbacks(
      {
        onSuccess: async (schedule, request) => {
          // Client-side until scheduled_action reports to PostHog itself.
          analytics.track('routine_created', {
            routineId: schedule.id ?? undefined,
            source: request.suggestionId ? 'suggestion' : source,
            suggestionId: request.suggestionId,
            triggerType: schedule.trigger.type,
            targetKind: routineTargetKind(schedule),
          });
          upsertSchedule(schedule);
          if (request.suggestionId)
            await removeAcceptedSuggestion(request.suggestionId);
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
    { scheduleId: string; body: ActionConfigurationUpdate }
  >
) {
  return useMutation(() => ({
    mutationFn: async (args: {
      scheduleId: string;
      body: ActionConfigurationUpdate;
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
          await Promise.all([
            queryClient.cancelQueries({
              queryKey: scheduledActionKeys.list.queryKey,
            }),
            queryClient.cancelQueries({
              queryKey: scheduledActionKeys.detail({ scheduleId }).queryKey,
            }),
          ]);
          const previousEnabled =
            queryClient.getQueryData<ScheduledAction>(
              scheduledActionKeys.detail({ scheduleId }).queryKey
            )?.enabled ??
            queryClient
              .getQueryData<ScheduledAction[]>(
                scheduledActionKeys.list.queryKey
              )
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

/**
 * Keep a sub-routine as the owner's own routine. It joins the main list and
 * leaves its parent's, so both are read again.
 */
export function useDetachScheduleMutation(
  callbacks?: MutationCallbacks<ScheduledAction, Error, { scheduleId: string }>
) {
  return useMutation(() => ({
    mutationFn: async (args: { scheduleId: string }) =>
      throwOnErr(async () => await scheduledActionClient.detach(args)),
    ...withCallbacks(
      {
        onSuccess: async (schedule: ScheduledAction) => {
          if (schedule.id)
            queryClient.setQueryData(
              scheduledActionKeys.detail({ scheduleId: schedule.id }).queryKey,
              schedule
            );
          await invalidateSchedules();
        },
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
  // websocket sync (features/routines/queries/sync.ts). Invalidating on
  // HTTP success would race the synthetic pending row from the `started`
  // event and wipe it before the server persists the real record — so the
  // success path is intentionally a no-op here.
  return useMutation(() => ({
    mutationFn: async ({ scheduleId }: { scheduleId: string }) =>
      throwOnErr(
        async () => await scheduledActionClient.runNow({ scheduleId })
      ),
    ...withCallbacks(
      {
        // A run the server accepted, not its outcome; scheduled and event
        // runs never pass through the client.
        onSuccess: (_execution, { scheduleId }) => {
          const schedule =
            queryClient.getQueryData<ScheduledAction>(
              scheduledActionKeys.detail({ scheduleId }).queryKey
            ) ??
            queryClient
              .getQueryData<ScheduledAction[]>(
                scheduledActionKeys.list.queryKey
              )
              ?.find((item) => item.id === scheduleId);
          analytics.track('routine_run', {
            routineId: scheduleId,
            trigger: 'manual',
            targetKind: schedule && routineTargetKind(schedule),
          });
        },
      },
      callbacks
    ),
  }));
}
