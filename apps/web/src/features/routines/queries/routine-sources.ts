import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import type { Accessor } from 'solid-js';
import { createMemo, onMount } from 'solid-js';
import type {
  RoutineCreatorSource,
  RoutineDetailSource,
  RoutineListSource,
} from '../context/routine-sources';
import type { RoutineSnapshot } from '../core/routine';
import { scheduleToEntity } from './entities';
import {
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  scheduleToDuplicateBody,
} from './routine-draft';
import { useRoutineQuery } from './routines';
import { toHistoryRecord } from './run-resource';
import {
  invalidateSchedules,
  useCreateScheduleMutation,
  useRunScheduleNowMutation,
  useScheduleHistoryQuery,
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
  useUpdateScheduleMutation,
} from './schedules';

function toRoutine(schedule: ScheduledAction): RoutineSnapshot {
  if (!schedule.id) throw new Error('Routine has no ID');
  return {
    id: schedule.id,
    name: schedule.name,
    ownerId: schedule.owner,
    createdAt: schedule.created_at,
    enabled: schedule.enabled,
    nextRunAt: schedule.next_run_at,
    claimedAt: schedule.claimed,
    revision: schedule.configuration_revision,
    configurationKey: JSON.stringify([
      schedule.name,
      schedule.kind,
      schedule.trigger,
      schedule.task,
    ]),
    draft: draftFromSchedule(schedule),
  };
}

type DetailCallbacks = {
  onError(title: string, error: unknown): void;
  onDuplicated(id: string): void;
};

export function createRoutineDetailSource(
  id: Accessor<string>,
  callbacks: DetailCallbacks
): RoutineDetailSource {
  const list = useSchedulesQuery(() => true);
  const detail = useRoutineQuery(id);
  const raw = createMemo(
    () =>
      (detail.isSuccess || detail.isError ? detail.data : undefined) ??
      (list.isSuccess || list.isError
        ? list.data?.find((item) => item.id === id())
        : undefined)
  );
  const routine = createMemo(() => {
    const current = raw();
    return current?.id ? toRoutine(current) : undefined;
  });
  const update = useUpdateScheduleMutation();
  const run = useRunScheduleNowMutation({
    onError: (error) => callbacks.onError('Failed to start run', error),
  });
  const activate = useSetScheduleEnabledMutation({
    onError: (error) => callbacks.onError('Failed to update routine', error),
  });
  const duplicate = useCreateScheduleMutation({
    onSuccess: (created) => {
      if (created.id) callbacks.onDuplicated(created.id);
    },
    onError: (error) => callbacks.onError('Failed to duplicate routine', error),
  });
  const history = useScheduleHistoryQuery(id, () => Boolean(raw()));
  onMount(() => {
    void invalidateSchedules();
  });
  return {
    routine,
    entity: () => {
      const current = raw();
      return current ? scheduleToEntity(current) : undefined;
    },
    loading: () => detail.isPending,
    error: () => detail.isError,
    async update(draft) {
      const previous = raw();
      const body = previous && draftToUpdateBody(draft, previous);
      if (!body) throw new Error('Choose a valid execution target.');
      return toRoutine(await update.mutateAsync({ scheduleId: id(), body }));
    },
    run: () => run.mutate({ scheduleId: id() }),
    runPending: () => run.isPending,
    setEnabled: (enabled) => activate.mutate({ scheduleId: id(), enabled }),
    activationPending: () => activate.isPending,
    duplicate() {
      const current = raw();
      const body = current && scheduleToDuplicateBody(current);
      if (body && !duplicate.isPending) duplicate.mutate(body);
    },
    duplicationPending: () => duplicate.isPending,
    history: createMemo(() =>
      history.isSuccess ? (history.data ?? []).map(toHistoryRecord) : []
    ),
    historyLoading: () => history.isPending,
    historyError: () => history.isError,
    refreshHistory: () => history.refetch(),
  };
}

export function createRoutineCreatorSource(): RoutineCreatorSource {
  const mutation = useCreateScheduleMutation();
  return {
    pending: () => mutation.isPending,
    async create(draft) {
      const created = await mutation.mutateAsync(draftToCreateBody(draft));
      if (!created.id) throw new Error('Created routine has no ID');
      return created.id;
    },
  };
}

export function createRoutineListSource(
  onError: (error: unknown) => void
): RoutineListSource {
  const query = useSchedulesQuery(() => true);
  const toggle = useSetScheduleEnabledMutation({ onError });
  return {
    routines: createMemo(() =>
      (query.isSuccess || query.isError ? (query.data ?? []) : [])
        .filter((item) => item.id)
        .map(toRoutine)
    ),
    loading: () => query.isPending,
    error: () => query.isError,
    refresh: () => query.refetch(),
    pendingId: () =>
      toggle.isPending ? toggle.variables?.scheduleId : undefined,
    setEnabled: (id, enabled) => toggle.mutate({ scheduleId: id, enabled }),
  };
}
