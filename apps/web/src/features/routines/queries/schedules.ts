import { removeAcceptedSuggestion } from '@app/features/routine-suggestions/queries/routine-suggestions';
import { analytics } from '@app/lib/analytics';
import { throwOnErr } from '@core/util/result';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
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
  type RefetchOptions,
  useMutation,
  useQuery,
} from '@tanstack/solid-query';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { readScheduleList } from './claims';
import { scheduledActionKeys } from './keys';
import { routineTargetKind } from './routine-draft';
import {
  routineQueryTrace,
  traceRoutineRequest,
  withRoutineQueryTrace,
} from './routine-trace';

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

  if (schedule.sub_routine) {
    if (!schedule.id) return;
    // The children query controls active membership. A detail response can
    // also describe a completed child, so only update an existing row.
    removeSchedule(schedule.id);
    queryClient.setQueryData(
      scheduledActionKeys.subRoutines.queryKey,
      (current: ScheduledAction[] | undefined) =>
        current?.map((item) =>
          item.id === schedule.id ? { ...item, ...schedule } : item
        )
    );
    return;
  }

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
  return readScheduleList(() =>
    throwOnErr(() => scheduledActionClient.listSchedules())
  );
}

export function useSchedulesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.list.queryKey,
    enabled: enabled(),
    queryFn: fetchSchedules,
    behavior: routineQueryTrace,
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

function fetchCodeUpgrades(scheduleId: string) {
  return throwOnErr(() =>
    scheduledActionClient.listCodeUpgrades({ scheduleId })
  );
}

type CodeUpgradeTrace = { active: TraceContext | undefined };

// Cached past unmount. A traced refresh supplies a holder that clears on settle.
function codeUpgradesQueryOptions(
  scheduleId: string | null | undefined,
  enabled: boolean,
  trace?: CodeUpgradeTrace
) {
  const fetch = () => fetchCodeUpgrades(scheduleId!);
  return queryOptions({
    queryKey: scheduledActionKeys.codeUpgrades({
      scheduleId: scheduleId ?? '__none__',
    }).queryKey,
    enabled: enabled && Boolean(scheduleId),
    queryFn: () => (trace?.active ? trace.active.run(fetch) : fetch()),
    ...QUERY_REFETCH_BEHAVIOR,
  });
}

async function refreshCodeUpgrades(id: string, parentSpan: TraceContext) {
  // Keep the explicit parent through retries and release it if the query
  // retains these options after the operation settles.
  const trace: CodeUpgradeTrace = { active: parentSpan };
  const options = codeUpgradesQueryOptions(id, true, trace);
  try {
    await queryClient.cancelQueries({
      queryKey: options.queryKey,
      exact: true,
    });
    return await queryClient.fetchQuery({ ...options, staleTime: 0 });
  } finally {
    trace.active = undefined;
  }
}

/** How the routine's code steps were brought to new SDKs, newest first. */
export function useCodeUpgradesQuery(
  scheduleId: Accessor<string | null | undefined>,
  enabled: Accessor<boolean>
) {
  const query = useQuery(() =>
    codeUpgradesQueryOptions(scheduleId(), enabled())
  );
  return {
    get data() {
      return query.data;
    },
    get isSuccess() {
      return query.isSuccess;
    },
    async refetch({
      parentSpan,
      ...options
    }: RefetchOptions & { parentSpan?: TraceContext } = {}) {
      const id = scheduleId();
      if (!parentSpan || !id) return query.refetch(options);

      return refreshCodeUpgrades(id, parentSpan);
    },
  };
}

function fetchSubRoutines() {
  return readScheduleList(() =>
    throwOnErr(() => scheduledActionClient.listSubRoutines())
  );
}

// Cached past unmount; closes over the resolved routine id only.
function childrenQueryOptions(scheduleId: string, enabled: boolean) {
  return queryOptions({
    queryKey: scheduledActionKeys.children({ scheduleId }).queryKey,
    enabled,
    behavior: routineQueryTrace,
    queryFn: () =>
      readScheduleList(() =>
        throwOnErr(() => scheduledActionClient.listChildren({ scheduleId }))
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
 * failing at once, offline too, rather than retrying while the confirmation
 * is open. A read already in flight may predate a child a run just made, so
 * it is waited out and the children read after it (or with the read a run's
 * stop queued after it). The read runs in `parent`, which an awaited earlier
 * read would otherwise lose.
 */
export function fetchChildren(scheduleId: string, parent?: TraceContext) {
  const options = {
    ...childrenQueryOptions(scheduleId, true),
    staleTime: 0,
    retry: false,
    networkMode: 'always' as const,
  };
  const pending = queryClient
    .getQueryCache()
    .find({ queryKey: options.queryKey, exact: true });
  // Taken now: the read in flight when Delete asked, not one started later.
  const earlier =
    pending?.state.fetchStatus === 'fetching' ? pending.promise : undefined;
  const read = async () => {
    if (earlier) await Promise.allSettled([earlier]);
    const fetch = () => queryClient.fetchQuery(options);
    return parent ? parent.run(fetch) : fetch();
  };
  return ResultAsync.fromPromise(read(), (error) => error);
}

/** Every active routine another routine's run created. */
export function useSubRoutinesQuery(enabled: Accessor<boolean>) {
  return useQuery(() => ({
    queryKey: scheduledActionKeys.subRoutines.queryKey,
    enabled: enabled(),
    queryFn: fetchSubRoutines,
    behavior: routineQueryTrace,
    placeholderData: keepPreviousData,
    reconcile: 'id',
    ...QUERY_REFETCH_BEHAVIOR,
  }));
}

export function invalidateSchedules(parentSpan?: TraceContext) {
  return withRoutineQueryTrace(parentSpan, (options) =>
    Promise.all(
      [
        scheduledActionKeys.list.queryKey,
        scheduledActionKeys.subRoutines.queryKey,
        scheduledActionKeys.children._def,
        scheduledActionKeys.detail._def,
      ].map((queryKey) => queryClient.invalidateQueries({ queryKey }, options))
    )
  );
}

async function cacheDetachedSchedule(schedule: ScheduledAction) {
  const scheduleId = schedule.id;
  if (!scheduleId) return;
  const detailKey = scheduledActionKeys.detail({ scheduleId }).queryKey;
  const childKeys = [
    scheduledActionKeys.subRoutines.queryKey,
    scheduledActionKeys.children._def,
  ];
  // Don't let a read started before the detach restore the old parent link.
  await Promise.all(
    [...childKeys, scheduledActionKeys.list.queryKey, detailKey].map(
      (queryKey) => queryClient.cancelQueries({ queryKey })
    )
  );
  for (const queryKey of childKeys) {
    queryClient.setQueriesData<ScheduledAction[]>({ queryKey }, (rows) =>
      rows?.filter((row) => row.id !== scheduleId)
    );
  }
  queryClient.setQueryData(detailKey, schedule);
  upsertSchedule(schedule);
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
  parentSpan?: TraceContext;
};

export function useCreateScheduleMutation(
  callbacks?: MutationCallbacks<ScheduledAction, Error, CreateScheduleRequest>,
  /** Whether the user created the routine or duplicated one, for analytics. */
  source: 'new' | 'duplicate' = 'new'
) {
  return useMutation(() => ({
    mutationFn: ({ body, suggestionId, parentSpan }: CreateScheduleRequest) =>
      (parentSpan ?? Telemetry.captureContext()).run(() =>
        throwOnErr(() =>
          scheduledActionClient.createSchedule(body, { suggestionId })
        )
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
          await invalidateSchedules(request.parentSpan);
        },
      },
      callbacks
    ),
  }));
}

type ScheduleUpdate = {
  scheduleId: string;
  body: ActionConfigurationUpdate;
  parentSpan?: TraceContext;
};

export function useUpdateScheduleMutation(
  callbacks?: MutationCallbacks<ScheduledAction, Error, ScheduleUpdate>
) {
  return useMutation(() => ({
    mutationFn: ({ parentSpan, ...request }: ScheduleUpdate) =>
      (parentSpan ?? Telemetry.captureContext()).run(() =>
        throwOnErr(() => scheduledActionClient.updateSchedule(request))
      ),
    ...withCallbacks(
      {
        onSuccess: async (schedule, { parentSpan }) => {
          upsertSchedule(schedule);
          await invalidateSchedules(parentSpan);
        },
      },
      callbacks
    ),
  }));
}

type ScheduleActivation = {
  scheduleId: string;
  enabled: boolean;
  parentSpan?: TraceContext;
};
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
    mutationFn: ({ parentSpan, ...request }: ScheduleActivation) =>
      (parentSpan ?? Telemetry.captureContext()).run(() =>
        throwOnErr(() => scheduledActionClient.setEnabled(request))
      ),
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
              ?.find((item) => item.id === scheduleId)?.enabled ??
            queryClient
              .getQueryData<ScheduledAction[]>(
                scheduledActionKeys.subRoutines.queryKey
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
        onSettled: (_schedule, _error, { parentSpan }) =>
          invalidateSchedules(parentSpan),
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
  callbacks?: MutationCallbacks<
    ScheduledAction,
    Error,
    { scheduleId: string; parentSpan?: TraceContext }
  >
) {
  return useMutation(() => ({
    mutationFn: ({
      scheduleId,
      parentSpan,
    }: {
      scheduleId: string;
      parentSpan?: TraceContext;
    }) => {
      const span = (parentSpan ?? Telemetry.captureContext()).run(() =>
        Telemetry.span('routine.detach', {
          attributes: { 'routine.id': scheduleId },
        })
      );
      return traceRoutineRequest(span, async () => {
        const schedule = await throwOnErr(() =>
          scheduledActionClient.detach({ scheduleId })
        );
        await cacheDetachedSchedule(schedule);
        await invalidateSchedules(span);
        return schedule;
      });
    },
    ...withCallbacks({}, callbacks),
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
