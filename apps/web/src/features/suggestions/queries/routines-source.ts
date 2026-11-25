import { useRoutineSuggestions } from '@app/features/routine-suggestions/queries/routine-suggestions';
import {
  useSchedulesQuery,
  useSetScheduleEnabledMutation,
} from '@app/features/routines/queries/schedules';
import type { RoutinesSource } from '../context/suggestions-source';

/**
 * The person's routines and routine ideas over the routines feature's own
 * queries, for the For you page's sidebar and its turned-on rows. Opening
 * the routines page is the app's, so it is passed in.
 */
export function useRoutinesSource(
  openRoutines: (routineId?: string) => void
): RoutinesSource {
  const ideas = useRoutineSuggestions();
  const schedules = useSchedulesQuery(() => true);
  const toggle = useSetScheduleEnabledMutation();
  // FE-48: read data only once settled, and keep it through refetch errors.
  const saved = () =>
    schedules.isPending
      ? undefined
      : (schedules.data ?? []).filter((schedule) => schedule.id);

  return {
    ideas: () => ideas.suggestions()?.length,
    routines: () => saved()?.length,
    enabled: (routineId) =>
      saved()?.find((schedule) => schedule.id === routineId)?.enabled,
    async setEnabled(routineId, enabled) {
      await toggle.mutateAsync({ scheduleId: routineId, enabled });
    },
    openRoutines,
  };
}
