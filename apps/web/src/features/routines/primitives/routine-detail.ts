import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { RoutineDetailSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import type { ScheduleDraft } from '../core/draft';
import { formatDateTime, validateRoutineDraft } from '../core/routine-draft';
import { hasOnlyScheduledTriggers } from '../core/routine-triggers';
import { createRoutineAutosave } from './routine-autosave';

export class RoutineConflictError extends Error {
  constructor() {
    super(
      'This routine changed elsewhere. Reload the latest settings before editing.'
    );
  }
}
export function createRoutineDetail(
  source: RoutineDetailSource,
  options: {
    userId: Accessor<string | undefined>;
    onRename(name: string): void;
  }
) {
  const schedule = source.routine;
  const isOwned = () => schedule()?.ownerId === options.userId();
  const editableTrigger = () => Boolean(schedule());
  const isRunning = () => isClaimActive(schedule()?.claimedAt);
  const isActive = () => schedule()?.enabled ?? false;
  const [state, setRawState] = createSignal<ScheduleDraft | undefined>();
  const [editorVersion, setEditorVersion] = createSignal(0);
  let baselineRevision = 0;
  let baselineKey = '';

  const isCompleted = () =>
    hasOnlyScheduledTriggers(state()?.triggers) &&
    !schedule()?.nextRunAt &&
    !isRunning();

  const formError = () => {
    const draft = state();
    return draft ? validateRoutineDraft(draft) : null;
  };

  const autosave = createRoutineAutosave<ScheduleDraft>(async (draft) => {
    const previous = schedule();
    if (!previous || !editableTrigger()) {
      throw new Error('This routine is no longer editable.');
    }
    if (
      previous.revision > baselineRevision &&
      previous.configurationKey !== baselineKey
    )
      throw new RoutineConflictError();
    const saved = await source.update(draft);
    baselineRevision = saved.revision;
    baselineKey = saved.configurationKey;
  });

  function setState(update: (prev: ScheduleDraft) => ScheduleDraft): void {
    const current = state();
    if (!isOwned() || !current || !editableTrigger() || isRunning()) return;
    const next = update(current);
    if (next === current) return;
    setRawState(next);
    if (next.name !== current.name) {
      options.onRename(next.name);
    }
    autosave.queue(formError() ? undefined : next);
  }

  function runNow(): void {
    if (
      !isOwned() ||
      !editableTrigger() ||
      !state() ||
      formError() ||
      autosave.dirty() ||
      autosave.saving() ||
      source.runPending() ||
      isRunning()
    )
      return;
    source.run();
  }

  function initializeDraft(): void {
    const current = schedule();
    if (!current) return;
    baselineRevision = current.revision;
    baselineKey = current.configurationKey;
    setRawState(current.draft);
    setEditorVersion((version) => version + 1);
    options.onRename(current.name);
  }

  // A server revision refreshes clean settings, while a pending edit keeps its
  // original revision so a conflicting remote change cannot be overwritten.
  createEffect(
    on(
      () => schedule()?.revision,
      (revision) => {
        if (revision === undefined) return;
        if (
          !state() ||
          (revision > baselineRevision &&
            !autosave.dirty() &&
            !autosave.saving())
        )
          initializeDraft();
      }
    )
  );

  const nextRun = () => {
    if (!isActive()) return 'Paused';
    const next = schedule()?.nextRunAt;
    if (next) return formatDateTime(next);
    if (isRunning()) return 'Running now';
    if (isCompleted()) return 'No upcoming runs';
    return 'On the next matching event';
  };

  const runDisabled = () =>
    !isOwned() ||
    source.runPending() ||
    isRunning() ||
    autosave.dirty() ||
    autosave.saving() ||
    Boolean(formError()) ||
    !state();
  const activationDisabled = () =>
    !isOwned() ||
    source.activationPending() ||
    (!isActive() && (isCompleted() || runDisabled()));

  return {
    schedule,
    state,
    setState,
    isOwned,
    isRunning,
    isActive,
    editorVersion,
    formError,
    autosave,
    initializeDraft,
    nextRun,
    runDisabled,
    activationDisabled,
    runNow,
  };
}
