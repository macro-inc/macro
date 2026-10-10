import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { CalendarGridSkeleton } from '@app/features/calendar/components/CalendarGridSkeleton';
import { isMobile } from '@core/mobile/isMobile';

const monthTitle = () =>
  new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(
    new Date()
  );

/** Calendar while its code loads: the month title over an empty week grid. */
export function CalendarViewSkeleton() {
  return (
    <ViewSkeleton.Root
      asidePreferenceKey="calendar"
      aside={isMobile() ? false : { preserveDuringResize: false }}
    >
      <ViewSkeleton.Sidebar title="Calendar" createLabel="New" />
      <ViewSkeleton.Main title={monthTitle()}>
        <div class="flex min-h-0 flex-1">
          <CalendarGridSkeleton dayCount={7} showDayHeader showAllDaySlot />
        </div>
      </ViewSkeleton.Main>
    </ViewSkeleton.Root>
  );
}
