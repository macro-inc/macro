import { type RoutineEntity, routineStatus } from '@entity/types/entity';
import type { ScheduledAction } from '@service-scheduled-action/generated/schemas';
import { createMemo } from 'solid-js';
import { isClaimActive } from '../core/claim';
import { useSchedulesQuery } from './schedules';
import { getCronTrigger } from './triggers';

export { isClaimActive } from '../core/claim';

export function scheduleToEntity(
  schedule: ScheduledAction
): RoutineEntity | undefined {
  const trigger = getCronTrigger(schedule);
  if (!schedule.id) return undefined;
  return {
    id: schedule.id,
    type: 'routine',
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
 * Reactive list of routine entities derived from the scheduled-action
 * query. Safe to call from any component tree that's under a QueryClient —
 * returns `[]` until the query resolves.
 */
export function useRoutineEntities() {
  const schedulesQuery = useSchedulesQuery(() => true);
  return createMemo<RoutineEntity[]>(() => {
    const data = schedulesQuery.isPending ? undefined : schedulesQuery.data;
    if (!data) return [];
    const out: RoutineEntity[] = [];
    for (const schedule of data) {
      const entity = scheduleToEntity(schedule);
      if (entity) out.push(entity);
    }
    return out;
  });
}
