import { t } from '@app/lib/i18n';
import { type ComponentProps, createMemo } from 'solid-js';
import { draftFromSchedule } from '../routines/queries/routine-draft';
import { useSchedulesQuery } from '../routines/queries/schedules';
import { PhoneAgentsNavigation } from './views/mobile/agents-navigation';

/** Uses the same owner-scoped, shared query as the existing routine surfaces. */
export function PhoneAgentsSidebar(
  props: Omit<ComponentProps<typeof PhoneAgentsNavigation>, 'routines'>
) {
  const schedules = useSchedulesQuery(() => true, false);
  const routines = createMemo(() =>
    (schedules.isSuccess ? schedules.data : []).flatMap((schedule) => {
      if (!schedule.id) return [];
      const draft = draftFromSchedule(schedule);
      const labels = {
        hour: t('agentWork.routineHourly'),
        day: t('agentWork.routineDaily'),
        week: t('agentWork.routineWeekly'),
        month: t('agentWork.routineMonthly'),
        once: t('agentWork.routineOnce'),
        custom: t('agentWork.scheduledRoutine'),
        event: t('agentWork.routineOnEvent'),
      };
      const frequencies: (keyof typeof labels)[] = draft?.triggers?.length
        ? draft.triggers.map((trigger) =>
            trigger.kind === 'event' ? 'event' : trigger.frequency
          )
        : [draft?.frequency ?? 'custom'];
      return [
        {
          id: schedule.id,
          name: schedule.name,
          schedule: [...new Set(frequencies)]
            .map((frequency) => labels[frequency])
            .join(' · '),
        },
      ];
    })
  );
  return <PhoneAgentsNavigation {...props} routines={routines()} />;
}
