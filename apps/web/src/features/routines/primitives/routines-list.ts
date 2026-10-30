import { type Accessor, createMemo } from 'solid-js';
import type { RoutineListSource } from '../context/routine-sources';
import { isClaimActive } from '../core/claim';
import { describeSchedule, getDefaultTimezone } from '../core/routine-draft';
import { firstAgent } from '../core/routine-steps';
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
        const agent = draft?.steps
          ? firstAgent(draft.steps)?.target
          : draft?.target;
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
          target: agent
            ? targetLabel(agent)
            : draft?.steps
              ? 'Actions'
              : 'Agent',
          targetModel: agent ? targetModel(agent) : undefined,
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
