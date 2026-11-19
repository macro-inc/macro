import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import type { ScheduledActionResponse } from '@service-scheduled-action/generated/schemas';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { createMemo, createSignal, onMount } from 'solid-js';
import { readEntityAppearance } from '../../entity-appearance/core/appearance';
import type {
  RoutineCreatorSource,
  RoutineDetailSource,
  RoutineListSource,
  RoutineParentSummary,
  RoutineRowOperations,
} from '../context/routine-sources';
import { pendingCodeReview } from '../core/code-review';
import type { ScheduleDraft } from '../core/draft';
import type { RoutineSnapshot } from '../core/routine';
import { withDraftSteps } from '../core/routine-draft';
import { isSubRoutineCopy, programSteps } from '../core/routine-steps';
import {
  copyInputsFit,
  copyOf,
  draftHasDefinitionsOrInputs,
  hasProgramDefinitionsOrInputs,
  subRoutineFromWire,
  subRoutinesFromWire,
  wireDefinition,
} from '../core/sub-routines';
import { sharesAsTemplate } from '../core/template';
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
  fetchChildren,
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
    isCopy: isSubRoutineCopy(schedule.task),
    shareable: sharesAsTemplate(schedule.task),
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

function canKeepSchedule(
  schedule: ScheduledActionResponse,
  parent: ScheduledActionResponse | undefined
): boolean {
  const link = schedule.sub_routine;
  if (!link) return false;
  const copy = copyOf(schedule.task);
  if (!copy) return true;
  if (!parent || parent.id !== link.parent_id) return false;
  const definition = wireDefinition(parent.task, copy.subRoutine);
  return Boolean(definition && copyInputsFit(copy, definition));
}

async function traceRoutineRequest<T>(span: Span, request: () => Promise<T>) {
  try {
    return await span.run(request);
  } catch (error) {
    span.error('Routine request failed');
    throw error;
  } finally {
    span.end();
  }
}

export function createRoutineDetailSource(
  id: Accessor<string>,
  userId: Accessor<string | undefined>,
  callbacks: DetailCallbacks,
  subRoutineWrites: Accessor<boolean | undefined>
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
  const canEditTask = () => {
    const current = raw();
    return (
      !current ||
      subRoutineWrites() === true ||
      !hasProgramDefinitionsOrInputs(current.task)
    );
  };
  const duplicateBody = () => {
    const current = raw();
    return (
      current && scheduleToDuplicateBody(current, subRoutineWrites() === true)
    );
  };
  const update = useUpdateScheduleMutation();
  const run = useRunScheduleNowMutation({
    onError: (error) => callbacks.onError('Failed to start run', error),
  });
  const [approving, setApproving] = createSignal(false);
  const activate = useSetScheduleEnabledMutation({
    onError: (error) => {
      if (!approving()) callbacks.onError('Failed to update routine', error);
    },
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
      ? pendingCodeReview(upgrades.data ?? [], current.task)
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
  const parentLoading = () => Boolean(parentId() && list.isLoading);
  // Start the parent hold before releasing the detail hold when a copy arrives.
  usePending('routine.parent_definition', parentLoading, {
    'routine.id': id(),
  });
  usePending('routine.detail', () => detail.isLoading, { 'routine.id': id() });
  const rawParent = createMemo(() =>
    list.isSuccess || list.isError
      ? list.data?.find((item) => item.id === parentId())
      : undefined
  );
  const parent = createMemo<RoutineParentSummary | undefined>(() => {
    const found = rawParent();
    if (!found?.id) return undefined;
    const summary = { id: found.id, name: found.name };
    const current = raw();
    const copy = current && copyOf(current.task);
    if (!copy) return summary;
    const wire = wireDefinition(found.task, copy.subRoutine);
    if (!wire) return { ...summary, missing: 'gone' };
    const definition = subRoutineFromWire(wire);
    return definition
      ? { ...summary, definition }
      : { ...summary, missing: 'hidden' };
  });
  const keep = useDetachScheduleMutation({
    onSuccess: () => callbacks.onKept(),
    onError: (error) => callbacks.onError('Failed to keep the routine', error),
  });
  const canKeepAsOwn = () => {
    const current = raw();
    return Boolean(
      current &&
        current.owner === userId() &&
        canKeepSchedule(current, rawParent())
    );
  };
  const save = async (draft: ScheduleDraft, approval?: Span) => {
    const scheduleId = id();
    const previous = raw();
    const body = previous && draftToUpdateBody(draft, previous);
    if (!body) throw new Error('Choose a valid execution target.');
    if (
      subRoutineWrites() !== true &&
      hasProgramDefinitionsOrInputs(body.task) &&
      !deepEqual(body.task, previous.task)
    )
      throw new Error(t('subRoutines.writesDisabled'));
    // An edit that changes nothing (a blur, a value picked again) writes
    // nothing, so queued runs keep their configuration.
    if (isUnchangedUpdate(body, previous)) return toRoutine(previous);
    const span =
      approval?.span('routine.save') ??
      Telemetry.span('routine.save', {
        attributes: { 'routine.id': scheduleId },
      });
    return traceRoutineRequest(span, async () =>
      toRoutine(
        await update.mutateAsync({ scheduleId, body, parentSpan: span })
      )
    );
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
    setEnabled: (enabled) => {
      if (!approving()) activate.mutate({ scheduleId: id(), enabled });
    },
    activationPending: () => activate.isPending,
    canEditTask,
    canDuplicate: () => Boolean(duplicateBody()),
    duplicate() {
      const body = duplicateBody();
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
    parentLoading,
    parentError: () => Boolean(parentId() && list.isError && !rawParent()),
    refreshParent: () => list.refetch(),
    canKeepAsOwn,
    keepAsOwn: () => {
      if (canKeepAsOwn() && !keep.isPending) keep.mutate({ scheduleId: id() });
    },
    keepAsOwnPending: () => keep.isPending,
    codeReview,
    // Saving checks the proposal against the current SDK again. It holds
    // the sub-routines' rewritten code too.
    async approveCodeUpdate() {
      const scheduleId = id();
      const proposal = codeReview()?.proposal;
      const current = raw();
      if (
        !current ||
        current.owner !== userId() ||
        !canEditTask() ||
        approving() ||
        activate.isPending
      )
        return;
      const steps = proposal && programSteps(proposal.task);
      const subRoutines = proposal && subRoutinesFromWire(proposal.task);
      const draft = toRoutine(current).draft;
      if (!steps || !subRoutines || !draft) return;
      setApproving(true);
      const approval = Telemetry.span('routine.code_approval', {
        attributes: { 'routine.id': scheduleId },
      });
      try {
        await save(
          {
            ...withDraftSteps(draft, steps),
            ...(subRoutines.length ? { subRoutines } : {}),
          },
          approval
        );
        try {
          if (!current.enabled) {
            const phase = approval.span('routine.code_approval.activate');
            await traceRoutineRequest(phase, () =>
              activate.mutateAsync({
                scheduleId,
                enabled: true,
                parentSpan: phase,
              })
            );
          }
        } finally {
          if (id() === scheduleId) {
            await traceRoutineRequest(
              approval.span('routine.code_approval.refetch'),
              () => upgrades.refetch({ throwOnError: true })
            );
          }
        }
      } catch (error) {
        approval.error('Routine code approval failed');
        callbacks.onError('Failed to update the routine’s code', error);
      } finally {
        approval.end();
        setApproving(false);
      }
    },
    codeUpdatePending: approving,
  };
}

export function createRoutineCreatorSource(
  subRoutineWrites: Accessor<boolean | undefined>
): RoutineCreatorSource {
  const mutation = useCreateScheduleMutation();
  return {
    pending: () => mutation.isPending,
    async create(draft) {
      if (subRoutineWrites() !== true && draftHasDefinitionsOrInputs(draft)) {
        throw new Error(t('subRoutines.writesDisabled'));
      }
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
        .map((child) => ({
          ...toRoutine(child),
          canKeep: canKeepSchedule(
            child,
            query.isSuccess || query.isError
              ? query.data?.find(
                  (item) => item.id === child.sub_routine?.parent_id
                )
              : undefined
          ),
        }))
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

type RowOperationCallbacks = {
  /** Which operation failed, for the host to say so. */
  onError(operation: 'run' | 'duplicate' | 'keep', error: unknown): void;
  onRunStarted(): void;
  onDuplicated(id: string): void;
  /** The sub-routine became the owner's own routine. */
  onKept(): void;
};

/**
 * One request per routine at a time, for several routines at once: a mutation's
 * own `isPending` and `variables` cover only its latest call.
 */
function createPerRoutineMutation(mutate: (id: string) => Promise<unknown>) {
  const [pending, setPending] = createSignal<readonly string[]>([]);
  const settle = async (id: string) => {
    // The mutation's own callbacks report how it went.
    await ResultAsync.fromPromise(mutate(id), (error) => error);
    setPending((ids) => ids.filter((other) => other !== id));
  };
  return {
    start(id: string) {
      if (pending().includes(id)) return;
      setPending((ids) => [...ids, id]);
      fireAndForget(settle(id), 'routines');
    },
    pending: (id: string) => pending().includes(id),
  };
}

/**
 * What the list's row menus do, over the list's own queries: routines and
 * sub-routines both, since either can be a row.
 */
export function createRoutineRowOperations(
  callbacks: RowOperationCallbacks,
  subRoutineWrites: Accessor<boolean | undefined> = () => true
): RoutineRowOperations {
  const list = useSchedulesQuery(() => true);
  const children = useSubRoutinesQuery(() => true);
  const find = (id: string) =>
    (list.isSuccess || list.isError ? list.data : undefined)?.find(
      (item) => item.id === id
    ) ??
    (children.isSuccess || children.isError ? children.data : undefined)?.find(
      (item) => item.id === id
    );
  const run = useRunScheduleNowMutation({
    onSuccess: () => callbacks.onRunStarted(),
    onError: (error) => callbacks.onError('run', error),
  });
  const duplicate = useCreateScheduleMutation(
    {
      onSuccess: (created) => {
        if (created.id) callbacks.onDuplicated(created.id);
      },
      onError: (error) => callbacks.onError('duplicate', error),
    },
    'duplicate'
  );
  const keep = useDetachScheduleMutation({
    onSuccess: () => callbacks.onKept(),
    onError: (error) => callbacks.onError('keep', error),
  });
  const running = createPerRoutineMutation((id) =>
    run.mutateAsync({ scheduleId: id })
  );
  const duplicateBody = (id: string) => {
    const schedule = find(id);
    return (
      schedule && scheduleToDuplicateBody(schedule, subRoutineWrites() === true)
    );
  };
  const duplicating = createPerRoutineMutation(async (id) => {
    const body = duplicateBody(id);
    if (body) await duplicate.mutateAsync({ body });
  });
  const keeping = createPerRoutineMutation(async (id) => {
    const schedule = find(id);
    if (
      !schedule?.sub_routine ||
      !canKeepSchedule(schedule, find(schedule.sub_routine.parent_id))
    )
      return;
    await keep.mutateAsync({ scheduleId: id });
  });
  return {
    entity(id) {
      const schedule = find(id);
      return schedule ? scheduleToEntity(schedule) : undefined;
    },
    run: running.start,
    runPending: running.pending,
    duplicate: duplicating.start,
    canDuplicate: (id) => Boolean(duplicateBody(id)),
    keepAsOwn: keeping.start,
    async createdCount(id) {
      const created = await fetchChildren(id);
      return created.isOk() ? created.value.length : undefined;
    },
  };
}
