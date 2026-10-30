import { formatRelativeDate } from '@core/util/time';
import { type Accessor, createMemo } from 'solid-js';
import type { RoutineListSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import type { HistoryRecord } from '../core/history';
import type { RoutineSnapshot } from '../core/routine';
import type { StepDraft } from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import {
  describeTrigger,
  hasOnlyScheduledTriggers,
} from '../core/routine-triggers';
import { describeSteps } from '../core/step-catalog';
import { summarizeRun } from '../core/step-history';
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

function lastRun(
  record: HistoryRecord | undefined,
  steps: StepDraft[] | undefined
): RoutineRow['lastRun'] {
  const at = record?.startedAt;
  if (!record || !at) return undefined;
  return {
    at: runTime(at),
    failed: record.success === false,
    summary: summarizeRun(record, steps),
  };
}

function describeWork(
  routine: RoutineSnapshot,
  targetLabel: (target: RoutineTarget) => string
): string {
  const draft = routine.draft;
  if (!draft) return '';
  return draft.steps
    ? describeSteps(draft.steps)
    : `Ask AI · ${targetLabel(draft.target)}`;
}

export function createRoutineRows(
  source: RoutineListSource,
  userId: Accessor<string | undefined>,
  targetLabel: (target: RoutineTarget) => string
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
        return {
          id: routine.id,
          name: routine.name,
          createdAt: routine.createdAt,
          when: (draft?.triggers ?? []).map(describeTrigger).join(' · '),
          does: describeWork(routine, targetLabel),
          group: scheduled ? 'schedule' : 'activity',
          lastRun: lastRun(routine.lastRun, draft?.steps),
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
