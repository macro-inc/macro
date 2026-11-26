import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import type { ScheduledActionResponse } from '@service-scheduled-action/generated/schemas';
import { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { readEntityAppearance } from '../../entity-appearance/core/appearance';
import type {
  RoutineCreatorSource,
  RoutineDetailSource,
  RoutineListSource,
  RoutineRowOperations,
} from '../context/routine-sources';
import { pendingCodeReview, taskSdk } from '../core/code-review';
import type { ScheduleDraft } from '../core/draft';
import type { UnusableItem } from '../core/knobs';
import type { RoutineSnapshot } from '../core/routine';
import { withDraftSteps } from '../core/routine-draft';
import { picksItems, programSteps } from '../core/routine-steps';
import { isClaimActive, scheduleToEntity } from './entities';
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
  useStopRoutineRunMutation,
  useSubRoutinesQuery,
  useUnusableItemsQuery,
  useUpdateScheduleMutation,
} from './schedules';
import { unusableItemsFromWire } from './unusable-items';

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

/**
 * How the server refuses a routine to anyone but its owner: 401 without a
 * grant, 404 with a grant but no ownership.
 */
const REFUSED_READ_CODES = ['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND'];

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
  // A refetch with no data puts the query back to pending, so the refusal is
  // kept for this routine until a read settles otherwise; the page doesn't
  // swap views on every refocus.
  const refusedId = createMemo<string | undefined>((previous) => {
    if (detail.isSuccess) return undefined;
    if (detail.isError) {
      const refused = REFUSED_READ_CODES.some((code) =>
        thrownResultErrorHasCode(detail.error, code)
      );
      return refused ? id() : undefined;
    }
    return previous === id() ? previous : undefined;
  });
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
  // Only a routine that picks an item can have one go missing.
  const unusable = useUnusableItemsQuery(id, () => {
    const current = raw();
    return Boolean(
      current && current.owner === userId() && picksItems(current.task)
    );
  });
  const unusableItems = createMemo((): UnusableItem[] =>
    unusable.isPending ? [] : unusableItemsFromWire(unusable.data ?? [])
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
    // A refusal says nothing about a routine the viewer's own lists hold.
    readRefused: () => !raw() && refusedId() === id(),
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
    unusableItems,
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

type RowOperationCallbacks = {
  /** Which operation failed, for the host to say so. */
  onError(
    operation: 'run' | 'stop' | 'duplicate' | 'keep',
    error: unknown
  ): void;
  onRunStarted(): void;
  onDuplicated(id: string): void;
  /** The sub-routine became the owner's own routine. */
  onKept(): void;
};

/** How long a stopped run shows Stopping… at most, should its end not arrive. */
const STOP_HOLD_MS = 15_000;

/** A stop the server took, until the run it stopped ends. */
type StopHold = { id: string; token: number; lastRun: string | undefined };
/** The holds in force, and the newest stop already looked at. */
type HoldState = { held: readonly number[]; seen: number };

/** Which run finished last: it changes when the stopped run ends. */
function lastRunKey(
  schedule: ScheduledActionResponse | undefined
): string | undefined {
  return schedule?.last_run?.id ?? schedule?.last_run?.created_at;
}

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
  callbacks: RowOperationCallbacks
): RoutineRowOperations {
  const list = useSchedulesQuery(() => true);
  const children = useSubRoutinesQuery(() => true);
  const find = (id: string) =>
    (list.isPending ? undefined : list.data)?.find((item) => item.id === id) ??
    (children.isPending ? undefined : children.data)?.find(
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
  const stop = useStopRoutineRunMutation({
    onError: (error) => callbacks.onError('stop', error),
  });
  const running = createPerRoutineMutation((id) =>
    run.mutateAsync({ scheduleId: id })
  );
  // A stop the server took holds until that run ends, which the websocket
  // sync (or the reread after the stop) reports a moment later: until the
  // routine first shows no running claim or a newer last run (a refetch can
  // bring the end and the next claim at once), and never back after that, so
  // it doesn't reach a later run. Claims aren't compared: the sync stamps a
  // start with the browser's clock, a refetch with the server's. After
  // STOP_HOLD_MS Stop is offered again, in case the stop never reached the run.
  const [stops, setStops] = createSignal<readonly StopHold[]>([]);
  let lastToken = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  onCleanup(() => {
    for (const timer of timers) clearTimeout(timer);
  });
  const hold = (id: string, lastRun: string | undefined) => {
    lastToken += 1;
    const token = lastToken;
    setStops((all) => [
      ...all.filter((s) => s.id !== id),
      { id, token, lastRun },
    ]);
    const timer = setTimeout(() => {
      timers.splice(timers.indexOf(timer), 1);
      setStops((all) => all.filter((s) => s.token !== token));
    }, STOP_HOLD_MS);
    timers.push(timer);
  };
  // One trace from the click to the server's stop; ids only.
  const stopping = createPerRoutineMutation(async (id) => {
    // Taken before the request: the list reconciles into the same row.
    const schedule = find(id);
    const lastRun = lastRunKey(schedule);
    await Telemetry.span('routine.stop', async (span) => {
      span.setAttr('routine.id', id);
      // A routine not in the lists has no run to wait for.
      span.setAttr('routine.stop.run_known', !!schedule);
      await stop.mutateAsync({ scheduleId: id });
    });
    if (schedule) hold(id, lastRun);
  });
  const holds = createMemo(
    (prev: HoldState): HoldState => {
      const current = stops();
      const held = current
        .filter((s) => {
          const kept = s.token > prev.seen || prev.held.includes(s.token);
          const schedule = find(s.id);
          // Out of the lists while they load: keep the hold as it was.
          if (!schedule) return kept;
          return (
            kept &&
            isClaimActive(schedule.claimed) &&
            lastRunKey(schedule) === s.lastRun
          );
        })
        .map((s) => s.token);
      return {
        held,
        seen: Math.max(prev.seen, ...current.map((s) => s.token)),
      };
    },
    { held: [], seen: 0 }
  );
  const stopPending = (id: string) =>
    stopping.pending(id) ||
    stops().some((s) => s.id === id && holds().held.includes(s.token));
  const duplicating = createPerRoutineMutation(async (id) => {
    const schedule = find(id);
    const body = schedule && scheduleToDuplicateBody(schedule);
    if (body) await duplicate.mutateAsync({ body });
  });
  const keeping = createPerRoutineMutation((id) =>
    keep.mutateAsync({ scheduleId: id })
  );
  return {
    entity(id) {
      const schedule = find(id);
      return schedule ? scheduleToEntity(schedule) : undefined;
    },
    run: running.start,
    runPending: running.pending,
    stop: stopping.start,
    stopPending,
    duplicate: duplicating.start,
    keepAsOwn: keeping.start,
    async createdCount(id) {
      const created = await fetchChildren(id);
      return created.isOk() ? created.value.length : undefined;
    },
  };
}
