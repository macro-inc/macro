import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { AgendaSkeleton } from '@app/features/calendar/components/agenda/skeleton/AgendaSkeleton';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { Show } from 'solid-js';
import { CalendarMainSkeleton } from './views/calendar-header/CalendarMainSkeleton';

const monthTitle = () =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date()
  );

/** Calendar loading geometry follows the route or saved period. */
export function CalendarViewSkeleton(props: { period?: CalendarPeriodView }) {
  const period = () => props.period ?? getPreferredCalendarPeriodView();
  return (
    <ViewSkeleton.Root
      asidePreferenceKey="calendar"
      aside={{ preserveDuringResize: false }}
    >
      <ViewSkeleton.Sidebar title="Calendar" createLabel="New" />
      <CalendarMainSkeleton title={monthTitle()} period={period()}>
        <div class="flex min-h-0 flex-1 not-touch:m-3 not-touch:overflow-hidden not-touch:rounded-xl not-touch:bg-surface">
          <Show
            when={period() === 'agenda'}
            fallback={
              <CalendarGridSkeleton
                dayCount={period() === 'timeGridDay' ? 1 : 7}
                showDayHeader
                showAllDaySlot
              />
            }
          >
            <AgendaSkeleton />
          </Show>
        </div>
      </CalendarMainSkeleton>
    </ViewSkeleton.Root>
  );
}
