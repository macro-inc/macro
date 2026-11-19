import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { deepEqual } from '@core/util/compareUtils';
import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import type {
  ActionConfiguration,
  RoutineTask,
  ScheduledActionResponse,
} from '@service-scheduled-action/generated/schemas';
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
import { isClaimActive } from '../core/claim';
import { pendingCodeReview } from '../core/code-review';
import type { ScheduleDraft, SubRoutineCopyDraft } from '../core/draft';
import type { RoutineSnapshot } from '../core/routine';
import { withDraftSteps } from '../core/routine-draft';
import { isSubRoutineCopy, programSteps } from '../core/routine-steps';
import {
  copyInputsFit,
  copyOf,
  draftHasDefinitionsOrInputs,
  hasProgramDefinitionsOrInputs,
  retainedDefinitionApps,
  subRoutineFromWire,
  subRoutinesFromWire,
  wireDefinition,
} from '../core/sub-routines';
import { sharesAsTemplate } from '../core/template';
import { createRoutineConnectedApps } from './connected-apps';
import { scheduleToEntity } from './entities';
import {
  draftFromSchedule,
  draftToCreateBody,
  draftToUpdateBody,
  isUnchangedUpdate,
  scheduleToDuplicateBody,
} from './routine-draft';
import {
  traceRoutineInteraction,
  traceRoutineRequest,
  withRoutineQueryTrace,
} from './routine-trace';
import { readFreshRoutine, useRoutineQuery } from './routines';
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
  onError(title: string, error?: unknown): void;
  onDuplicated(id: string): void;
  /** The sub-routine became the owner's own routine. */
  onKept(): void;
};

function compatibleCopyParentTask(
  schedule: ScheduledActionResponse,
  parent: ScheduledActionResponse | undefined,
  eventWrites: boolean
) {
  const link = schedule.sub_routine;
  if (
    !link ||
    !canManageTrigger(schedule, eventWrites) ||
    isClaimActive(schedule.claimed) ||
    !parent ||
    parent.id !== link.parent_id
  )
    return;
  const copy = copyOf(schedule.task);
  if (!copy) return;
  if (copyMatchesDefinition(copy, parent.task)) return parent.task;
}

function copyMatchesDefinition(copy: SubRoutineCopyDraft, task: RoutineTask) {
  const definition = wireDefinition(task, copy.subRoutine);
  return !!definition && copyInputsFit(copy, definition);
}

function hasInvalidCopyReference(
  schedule: ScheduledActionResponse | undefined,
  parent: ScheduledActionResponse | undefined
): boolean {
  const copy = schedule && copyOf(schedule.task);
  return !!copy && !!parent && !copyMatchesDefinition(copy, parent.task);
}

function canManageTrigger(
  schedule: ScheduledActionResponse,
  eventWrites: boolean
) {
  const trigger = schedule.trigger;
  return (
    eventWrites ||
    (trigger?.type !== 'events' &&
      (trigger?.type !== 'multiple' ||
        !trigger.triggers.some((entry) => entry.type === 'events')))
  );
}

function canKeepSchedule(
  schedule: ScheduledActionResponse,
  parent: ScheduledActionResponse | undefined,
  connectedApps: ReadonlySet<string> | undefined,
  eventWrites: boolean
): boolean {
  if (!schedule.sub_routine) return false;
  if (!isSubRoutineCopy(schedule.task)) return true;
  const task = compatibleCopyParentTask(schedule, parent, eventWrites);
  return !!task && retainedAppsConnected(task, connectedApps);
}

function retainedAppsConnected(
  task: RoutineTask,
  connectedApps: ReadonlySet<string> | undefined
) {
  return retainedDefinitionApps(task).every((app) =>
    connectedApps?.has(app.app_slug)
  );
}

function duplicateWithConnections(
  body: ActionConfiguration | undefined,
  connectedApps: ReadonlySet<string> | undefined
) {
  if (body && retainedAppsConnected(body.task, connectedApps)) return body;
}

export function createRoutineDetailSource(
  id: Accessor<string>,
  userId: Accessor<string | undefined>,
  callbacks: DetailCallbacks,
  subRoutineWrites: Accessor<boolean | undefined>,
  eventWrites: Accessor<boolean>
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
  const canApproveTrigger = () => {
    const current = raw();
    return !!current && canManageTrigger(current, eventWrites());
  };
  const duplicateCandidate = () => {
    const current = raw();
    return current && canManageTrigger(current, eventWrites())
      ? scheduleToDuplicateBody(current, subRoutineWrites() === true)
      : undefined;
  };
  const duplicateBody = () =>
    duplicateWithConnections(duplicateCandidate(), connectedApps());
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
    get 'routine.parent_id'() {
      return parentId() ?? '';
    },
  });
  usePending('routine.detail', () => detail.isLoading, { 'routine.id': id() });
  const rawParent = createMemo(() =>
    list.isSuccess || list.isError
      ? list.data?.find((item) => item.id === parentId())
      : undefined
  );
  const connectedApps = createRoutineConnectedApps(() => {
    const current = raw();
    return Boolean(
      current &&
        current.owner === userId() &&
        (retainedDefinitionApps(
          compatibleCopyParentTask(current, rawParent(), eventWrites())
        ).length ||
          retainedDefinitionApps(duplicateCandidate()?.task).length)
    );
  });
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
        canKeepSchedule(current, rawParent(), connectedApps(), eventWrites())
    );
  };
  const save = async (
    draft: ScheduleDraft,
    {
      approval,
      queuedAt,
      previous = raw(),
    }: {
      approval?: Span;
      queuedAt?: number;
      previous?: ScheduledActionResponse;
    }
  ) => {
    const scheduleId = id();
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
        startTime: queuedAt,
        attributes: { 'routine.id': scheduleId },
      });
    if (queuedAt !== undefined) {
      span.setAttr('routine.save.queue_ms', Math.max(0, Date.now() - queuedAt));
    }
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
    update: (draft, queuedAt) => save(draft, { queuedAt }),
    run: () => run.mutate({ scheduleId: id() }),
    runPending: () => run.isPending,
    copyRunBlocked: () => hasInvalidCopyReference(raw(), rawParent()),
    setEnabled: (enabled) => {
      if (!approving()) activate.mutate({ scheduleId: id(), enabled });
    },
    activationPending: () => activate.isPending,
    canEditTask,
    canApproveTrigger,
    canDuplicate: () => Boolean(duplicateBody()),
    duplicate() {
      const body = duplicateBody();
      if (!body || duplicate.isPending) return;
      fireAndForget(
        traceRoutineInteraction('routine.duplicate', id(), (parentSpan) =>
          duplicate.mutateAsync({ body, parentSpan })
        ),
        'routines'
      );
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
    refreshParent: () =>
      traceRoutineInteraction(
        'routine.parent_definition.retry',
        id(),
        (span) => {
          span.setAttr('routine.parent_id', parentId() ?? '');
          return withRoutineQueryTrace(span, (options) =>
            list.refetch({ ...options, throwOnError: true })
          );
        }
      ),
    canKeepAsOwn,
    keepAsOwn: () => {
      if (!canKeepAsOwn() || keep.isPending) return;
      const scheduleId = id();
      fireAndForget(
        traceRoutineInteraction('routine.keep', scheduleId, (parentSpan) =>
          keep.mutateAsync({ scheduleId, parentSpan })
        ),
        'routines'
      );
    },
    keepAsOwnPending: () => keep.isPending,
    codeReview,
    // Saving checks the proposal against the current SDK again. It holds
    // the sub-routines' rewritten code too.
    async approveCodeUpdate() {
      const scheduleId = id();
      const proposal = codeReview()?.proposal;
      const cached = raw();
      if (
        !proposal ||
        !cached ||
        cached.owner !== userId() ||
        !canEditTask() ||
        !canApproveTrigger() ||
        approving() ||
        activate.isPending
      )
        return;
      const steps = programSteps(proposal.task);
      const subRoutines = subRoutinesFromWire(proposal.task);
      if (!steps || !subRoutines) return;
      setApproving(true);
      try {
        await traceRoutineInteraction(
          'routine.code_approval',
          scheduleId,
          async (approval, markFailed) => {
            const failed = (title: string, error?: unknown) => {
              markFailed();
              approval.error(title);
              callbacks.onError(title, error);
            };
            let current: ScheduledActionResponse;
            try {
              const phase = approval.span('routine.code_approval.check');
              current = await traceRoutineRequest(phase, () =>
                readFreshRoutine(scheduleId, phase)
              );
            } catch (error) {
              failed(t('subRoutines.approvalCheckFailed'), error);
              return;
            }
            if (
              id() !== scheduleId ||
              current.owner !== userId() ||
              !canManageTrigger(current, eventWrites())
            )
              return;
            if (!deepEqual(proposal.previousTask, current.task)) {
              failed(t('subRoutines.approvalTaskChanged'));
              return;
            }
            const draft = toRoutine(current).draft;
            if (!draft) return;
            try {
              await save(
                {
                  ...withDraftSteps(draft, steps),
                  ...(subRoutines.length ? { subRoutines } : {}),
                },
                { approval, previous: current }
              );
            } catch (error) {
              failed('Failed to update the routine’s code', error);
              return;
            }
            if (!current.enabled) {
              try {
                const phase = approval.span('routine.code_approval.activate');
                await traceRoutineRequest(phase, () =>
                  activate.mutateAsync({
                    scheduleId,
                    enabled: true,
                    parentSpan: phase,
                  })
                );
              } catch (error) {
                failed(t('subRoutines.approvalResumeFailed'), error);
              }
            }
            if (id() === scheduleId) {
              try {
                const phase = approval.span('routine.code_approval.refetch');
                await traceRoutineRequest(phase, () =>
                  upgrades.refetch({
                    throwOnError: true,
                    parentSpan: phase,
                  })
                );
              } catch (error) {
                failed(t('subRoutines.approvalRefreshFailed'), error);
              }
            }
          }
        );
      } finally {
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
        .filter((child) => child.id)
        .map(toRoutine)
    ),
    routines: createMemo(() =>
      (query.isSuccess || query.isError ? (query.data ?? []) : [])
        .filter((item) => item.id && !item.sub_routine)
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
  subRoutineWrites: Accessor<boolean | undefined> = () => true,
  eventWrites: Accessor<boolean> = () => true
): RoutineRowOperations {
  const list = useSchedulesQuery(() => true);
  const children = useSubRoutinesQuery(() => true);
  const saved = () => (list.isSuccess || list.isError ? (list.data ?? []) : []);
  const linked = () =>
    children.isSuccess || children.isError ? (children.data ?? []) : [];
  const find = (id: string) =>
    saved().find((item) => item.id === id) ??
    linked().find((item) => item.id === id);
  const parentFor = (schedule: ScheduledActionResponse) =>
    schedule.sub_routine ? find(schedule.sub_routine.parent_id) : undefined;
  const copyRunBlocked = (id: string) => {
    const schedule = find(id);
    return !!schedule && hasInvalidCopyReference(schedule, parentFor(schedule));
  };
  const duplicateCandidate = (schedule: ScheduledActionResponse) =>
    canManageTrigger(schedule, eventWrites())
      ? scheduleToDuplicateBody(schedule, subRoutineWrites() === true)
      : undefined;
  const [openMenus, setOpenMenus] = createSignal<readonly string[]>([]);
  const connectedApps = createRoutineConnectedApps(() =>
    openMenus().some((id) => {
      const schedule = find(id);
      if (!schedule) return false;
      const task = isSubRoutineCopy(schedule.task)
        ? compatibleCopyParentTask(schedule, parentFor(schedule), eventWrites())
        : duplicateCandidate(schedule)?.task;
      return retainedDefinitionApps(task).length > 0;
    })
  );
  const canKeepAsOwn = (id: string) => {
    const schedule = find(id);
    return (
      !!schedule &&
      canKeepSchedule(
        schedule,
        parentFor(schedule),
        connectedApps(),
        eventWrites()
      )
    );
  };
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
      schedule &&
      duplicateWithConnections(duplicateCandidate(schedule), connectedApps())
    );
  };
  const duplicating = createPerRoutineMutation(async (id) => {
    const body = duplicateBody(id);
    if (body)
      await traceRoutineInteraction('routine.duplicate', id, (parentSpan) =>
        duplicate.mutateAsync({ body, parentSpan })
      );
  });
  const keeping = createPerRoutineMutation((id) =>
    traceRoutineInteraction('routine.keep', id, (parentSpan) =>
      keep.mutateAsync({ scheduleId: id, parentSpan })
    )
  );
  return {
    entity(id) {
      const schedule = find(id);
      return schedule ? scheduleToEntity(schedule) : undefined;
    },
    run(id) {
      if (!copyRunBlocked(id)) running.start(id);
    },
    runPending: running.pending,
    copyRunBlocked,
    duplicate(id) {
      if (duplicateBody(id)) duplicating.start(id);
    },
    canDuplicate: (id) => Boolean(duplicateBody(id)),
    canKeepAsOwn,
    keepAsOwn(id) {
      if (canKeepAsOwn(id)) keeping.start(id);
    },
    setMenuOpen(id, open) {
      setOpenMenus((ids) => {
        if (ids.includes(id) === open) return ids;
        return open ? [...ids, id] : ids.filter((other) => other !== id);
      });
    },
    async createdCount(id) {
      const created = await fetchChildren(id);
      return created.isOk() ? created.value.length : undefined;
    },
  };
}
