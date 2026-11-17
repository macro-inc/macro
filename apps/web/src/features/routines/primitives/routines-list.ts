import { formatRelativeDate } from '@core/util/time';
import { type Accessor, createMemo } from 'solid-js';
import type { RoutineListSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import type { RoutineSnapshot } from '../core/routine';
import { summarizeWork } from '../core/routine-summary';
import {
  describeTrigger,
  hasOnlyScheduledTriggers,
  type RoutineTriggerDraft,
  triggerKind,
} from '../core/routine-triggers';
import { runOutcome, stepsForRun, summarizeRun } from '../core/step-history';
import type { RoutineRow } from '../core/types';

/** Today's runs show their time; older ones their day. */
function runTime(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date().toDateString() === date.toDateString();
  return today
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : formatRelativeDate(date);
}

function lastRun(routine: RoutineSnapshot): RoutineRow['lastRun'] {
  const record = routine.lastRun;
  const at = record?.startedAt;
  if (!record || !at) return undefined;
  return {
    at: runTime(at),
    outcome: runOutcome(record),
    summary: summarizeRun(record, stepsForRun(record, routine)),
  };
}

/** What starts the routine, its AI check included, in a line. */
function describeWhen(triggers: RoutineTriggerDraft[]): string {
  return triggers
    .map((trigger) => {
      const condition =
        trigger.kind === 'event' ? trigger.condition?.trim() : undefined;
      const text = describeTrigger(trigger);
      return condition ? `${text} · ${condition}` : text;
    })
    .join(' · ');
}

/**
 * The list's rows, newest first. With `nested`, each carries the routines
 * its runs created that still have work to do; without it (a phone) only
 * top-level routines show.
 */
export function createRoutineRows(
  source: RoutineListSource,
  userId: Accessor<string | undefined>,
  nested: Accessor<boolean> = () => true
) {
  const newestFirst = (routines: readonly RoutineSnapshot[]) =>
    routines.toSorted(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
    );
  const toRow = (routine: RoutineSnapshot): RoutineRow => {
    const created = nested()
      ? source.subRoutines().filter((child) => child.parent?.id === routine.id)
      : [];
    return {
      ...describe(routine),
      children: newestFirst(created).map((child) => ({
        ...describe(child),
        children: [],
      })),
    };
  };
  const describe = (routine: RoutineSnapshot): Omit<RoutineRow, 'children'> => {
    const draft = routine.draft;
    const running = isClaimActive(routine.claimedAt);
    const scheduled = hasOnlyScheduledTriggers(draft?.triggers);
    const completed = scheduled && !routine.nextRunAt && !running;
    const work = draft
      ? summarizeWork(draft.steps, draft.prompt)
      : { text: '' };
    const [first] = draft?.triggers ?? [];
    return {
      id: routine.id,
      name: routine.name,
      description: draft?.description?.trim() || undefined,
      createdAt: routine.createdAt,
      when: describeWhen(draft?.triggers ?? []),
      whenKind: first ? triggerKind(first) : undefined,
      does: work.text,
      ai: work.chip,
      group: scheduled ? 'schedule' : 'activity',
      lastRun: lastRun(routine),
      status: running
        ? 'Running'
        : completed
          ? 'Completed'
          : routine.enabled
            ? 'Active'
            : 'Paused',
      enabled: routine.enabled,
      editable: routine.ownerId === userId(),
      pausedByParent: routine.parent?.pausedByParent ?? false,
    };
  };
  return createMemo<RoutineRow[]>(() =>
    newestFirst(source.routines()).map(toRow)
  );
}
