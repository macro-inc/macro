import { type Accessor, createMemo } from 'solid-js';
import type { RoutineListSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import { describeSchedule, getDefaultTimezone } from '../core/routine-draft';
import type { RoutineTarget } from '../core/routine-target';
import { hasOnlyScheduledTriggers } from '../core/routine-triggers';
import type { RoutineRow } from '../core/types';

export function createRoutineRows(
  source: RoutineListSource,
  userId: Accessor<string | undefined>,
  targetLabel: (target: RoutineTarget) => string,
  targetModel: (target: RoutineTarget) => string | undefined
) {
  return createMemo<RoutineRow[]>(() =>
    source
      .routines()
      .toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((routine) => {
        const draft = routine.draft;
        const running = isClaimActive(routine.claimedAt);
        const completed =
          hasOnlyScheduledTriggers(draft?.triggers) &&
          !routine.nextRunAt &&
          !running;
        return {
          id: routine.id,
          name: routine.name,
          creator: 'You',
          createdAt: routine.createdAt,
          target: draft?.target ? targetLabel(draft.target) : 'Agent',
          targetModel: draft?.target ? targetModel(draft.target) : undefined,
          schedule: draft
            ? describeSchedule(draft, getDefaultTimezone())
            : 'Event triggered',
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
