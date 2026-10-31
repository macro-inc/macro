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
    summary: summarizeRun(
      record,
      stepsForRun(record, routine),
      routine.draft?.steps
    ),
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

export function createRoutineRows(
  source: RoutineListSource,
  userId: Accessor<string | undefined>
) {
  return createMemo<RoutineRow[]>(() =>
    source
      .routines()
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((routine) => {
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
        };
      })
  );
}
