import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { getPreferredCalendarPeriodView } from '@app/features/calendar/calendar-preferences';
import { AgendaSkeleton } from '@app/features/calendar/components/agenda/skeleton/AgendaSkeleton';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import type { CalendarPeriodView } from '@app/features/calendar/types';
import { calendarPeriodLabel } from '@app/features/calendar/utils/calendar-label';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';

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
      aside={isMobile() ? false : { preserveDuringResize: false }}
    >
      <ViewSkeleton.Sidebar title="Calendar" createLabel="New" />
      <ViewSkeleton.Main
        title={monthTitle()}
        controls={[
          'Booking links ⌄',
          'Today ‹ ›',
          `${calendarPeriodLabel(period())} ⌄`,
          '+ New ⌄',
          1,
        ]}
      >
        <div class="flex min-h-0 flex-1">
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
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
