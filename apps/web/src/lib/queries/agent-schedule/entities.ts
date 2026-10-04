import { type AutomationEntity, routineStatus } from '@entity/types/entity';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { createMemo } from 'solid-js';
import { useSchedulesQuery } from './schedules';
import { getCronTrigger } from './triggers';

// Must match `MAX_ACTION_TIME` on the backend
// (services/scheduled_action/src/domain/models.rs). After this window
// a claim is treated as stale — an executor crashed mid-run — so we stop
// reporting the action as running.
const MAX_CLAIMED_MS = 20 * 60 * 1000;

export function isClaimActive(claimed: string | undefined | null): boolean {
  if (!claimed) return false;
  return Date.now() - Date.parse(claimed) < MAX_CLAIMED_MS;
}

export function scheduleToEntity(
  schedule: ScheduledAction
): AutomationEntity | undefined {
  const trigger = getCronTrigger(schedule);
  if (!schedule.id) return undefined;
  return {
    id: schedule.id,
    type: 'automation',
    name: schedule.name,
    ownerId: schedule.owner,
    createdAt: schedule.created_at,
    updatedAt: schedule.updated_at,
    cron: trigger?.schedule,
    status: routineStatus({
      enabled: schedule.enabled,
      isRunning: isClaimActive(schedule.claimed),
      nextRunAt: schedule.next_run_at,
    }),
  };
}

/**
 * Reactive list of automation entities derived from the scheduled-action
 * query. Safe to call from any component tree that's under a QueryClient —
 * returns `[]` until the query resolves.
 */
export function useAutomationEntities() {
  const schedulesQuery = useSchedulesQuery(() => true);
  return createMemo<AutomationEntity[]>(() => {
    const data = schedulesQuery.isPending ? undefined : schedulesQuery.data;
    if (!data) return [];
    const out: AutomationEntity[] = [];
    for (const schedule of data) {
      const entity = scheduleToEntity(schedule);
      if (entity) out.push(entity);
    }
    return out;
  });
}
