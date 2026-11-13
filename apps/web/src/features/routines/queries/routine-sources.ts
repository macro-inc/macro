import { fireAndForget } from '@core/util/fireAndForget';
import type { ScheduledActionResponse } from '@service-scheduled-action/generated/schemas';
import type { Accessor } from 'solid-js';
import { createMemo, createSignal, onMount } from 'solid-js';
import { readEntityAppearance } from '../../entity-appearance/core/appearance';
import type {
  RoutineCreatorSource,
  RoutineDetailSource,
  RoutineListSource,
} from '../context/routine-sources';
import { pendingCodeReview, taskSdk } from '../core/code-review';
import type { ScheduleDraft } from '../core/draft';
import type { RoutineSnapshot } from '../core/routine';
import { withDraftSteps } from '../core/routine-draft';
import { programSteps } from '../core/routine-steps';
import { scheduleToEntity } from './entities';
import {
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  isUnchangedUpdate,
  scheduleToDuplicateBody,
} from './routine-draft';
import { useRoutineQuery } from './routines';
import { toHistoryRecord } from './run-resource';
import {
  invalidateSchedules,
  useChildrenQuery,
  useCodeUpgradesQuery,
  useCreateScheduleMutation,
  useDetachScheduleMutation,
  useRunScheduleNowMutation,
  useScheduleHistoryQuery,
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
  useSubRoutinesQuery,
  useUpdateScheduleMutation,
} from './schedules';

function toRoutine(schedule: ScheduledActionResponse): RoutineSnapshot {
  if (!schedule.id) throw new Error('Routine has no ID');
  return {
    id: schedule.id,
    name: schedule.name,
    appearance: readEntityAppearance(schedule.appearance),
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
      // The SDK its code was checked against is bookkeeping, not configuration.
      { ...schedule.task, sdk: undefined },
      schedule.run_visibility,
      schedule.description,
    ]),
    draft: draftFromSchedule(schedule),
    templateId: schedule.template_id ?? undefined,
    lastRun: schedule.last_run ? toHistoryRecord(schedule.last_run) : undefined,
    parent: schedule.sub_routine
      ? {
          id: schedule.sub_routine.parent_id,
          createdByRunId: schedule.sub_routine.created_by_run_id,
          pausedByParent: schedule.sub_routine.paused_by_parent ?? false,
        }
      : undefined,
  };
}

type DetailCallbacks = {
  onError(title: string, error: unknown): void;
  onDuplicated(id: string): void;
  /** The sub-routine became the owner's own routine. */
  onKept(): void;
};

export function createRoutineDetailSource(
  id: Accessor<string>,
  userId: Accessor<string | undefined>,
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
  const duplicate = useCreateScheduleMutation(
    {
      onSuccess: (created) => {
        if (created.id) callbacks.onDuplicated(created.id);
      },
      onError: (error) =>
        callbacks.onError('Failed to duplicate routine', error),
    },
    'duplicate'
  );
  const history = useScheduleHistoryQuery(id, () =>
    Boolean(raw() && raw()?.owner === userId())
  );
  const upgrades = useCodeUpgradesQuery(id, () =>
    Boolean(raw() && raw()?.owner === userId())
  );
  const codeReview = createMemo(() => {
    const current = raw();
    return current && upgrades.isSuccess
      ? pendingCodeReview(upgrades.data ?? [], taskSdk(current.task))
      : undefined;
  });
  // What this routine's runs created; a sub-routine creates none of its own.
  const created = useChildrenQuery(id, () =>
    Boolean(raw() && raw()?.owner === userId() && !raw()?.sub_routine)
  );
  const children = createMemo(() =>
    (created.isSuccess ? (created.data ?? []) : [])
      .filter((item) => item.id)
      .map(toRoutine)
  );
  const parentId = () => raw()?.sub_routine?.parent_id;
  const parent = createMemo(() => {
    const found =
      list.isSuccess || list.isError
        ? list.data?.find((item) => item.id === parentId())
        : undefined;
    return found?.id ? { id: found.id, name: found.name } : undefined;
  });
  const keep = useDetachScheduleMutation({
    onSuccess: () => callbacks.onKept(),
    onError: (error) => callbacks.onError('Failed to keep the routine', error),
  });
  const [approving, setApproving] = createSignal(false);
  const save = async (draft: ScheduleDraft) => {
    const previous = raw();
    const body = previous && draftToUpdateBody(draft, previous);
    if (!body) throw new Error('Choose a valid execution target.');
    // An edit that changes nothing (a blur, a value picked again) writes
    // nothing, so queued runs keep their configuration.
    if (isUnchangedUpdate(body, previous)) return toRoutine(previous);
    return toRoutine(await update.mutateAsync({ scheduleId: id(), body }));
  };
  onMount(() => {
    fireAndForget(invalidateSchedules(), 'routines');
  });
  return {
    routine,
    entity: () => {
      const current = raw();
      return current ? scheduleToEntity(current) : undefined;
    },
    loading: () => detail.isPending,
    error: () => detail.isError,
    update: save,
    run: () => run.mutate({ scheduleId: id() }),
    runPending: () => run.isPending,
    setEnabled: (enabled) => activate.mutate({ scheduleId: id(), enabled }),
    activationPending: () => activate.isPending,
    duplicate() {
      const current = raw();
      const body = current && scheduleToDuplicateBody(current);
      if (body && !duplicate.isPending) duplicate.mutate({ body });
    },
    duplicationPending: () => duplicate.isPending,
    history: createMemo(() =>
      history.isSuccess ? (history.data ?? []).map(toHistoryRecord) : []
    ),
    historyLoading: () => history.isPending,
    historyError: () => history.isError,
    refreshHistory: () => history.refetch(),
    subRoutines: children,
    parent,
    keepAsOwn: () => {
      if (!keep.isPending) keep.mutate({ scheduleId: id() });
    },
    keepAsOwnPending: () => keep.isPending,
    codeReview,
    // Saving checks the proposal against the current SDK again.
    async approveCodeUpdate() {
      const proposal = codeReview()?.proposal;
      const current = raw();
      const steps = proposal && programSteps(proposal.task);
      const draft = current && toRoutine(current).draft;
      if (!steps || !draft || approving()) return;
      setApproving(true);
      try {
        await save(withDraftSteps(draft, steps));
        activate.mutate({ scheduleId: id(), enabled: true });
        await upgrades.refetch();
      } catch (error) {
        callbacks.onError('Failed to update the routine’s code', error);
      } finally {
        setApproving(false);
      }
    },
    codeUpdatePending: approving,
  };
}

export function createRoutineCreatorSource(): RoutineCreatorSource {
  const mutation = useCreateScheduleMutation();
  return {
    pending: () => mutation.isPending,
    async create(draft) {
      const created = await mutation.mutateAsync({
        body: draftToCreateBody(draft),
        suggestionId: draft.suggestionId,
      });
      if (!created.id) throw new Error('Created routine has no ID');
      return created.id;
    },
  };
}

export function createRoutineListSource(
  onError: (error: unknown) => void
): RoutineListSource {
  const query = useSchedulesQuery(() => true);
  const children = useSubRoutinesQuery(() => true);
  const toggle = useSetScheduleEnabledMutation({ onError });
  return {
    subRoutines: createMemo(() =>
      (children.isSuccess || children.isError ? (children.data ?? []) : [])
        .filter((item) => item.id)
        .map(toRoutine)
    ),
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
