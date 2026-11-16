import { useCalendarView } from '@app/features/calendar/components/CalendarViewContext';
import { RangeUnavailableBanner } from '@app/features/calendar/components/RangeUnavailableBanner';
import { useCalendarNavigation } from '@app/features/calendar/context/calendar-navigation-context';
import { useCalendarOccurrenceData } from '@app/features/calendar/hooks/use-calendar-occurrence-data';
import { createCalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';
import { SetupStatus } from '../../components/SetupStatus';

/** Reuses the anchor window's cache entry for the existing account-setup states. */
export function AgendaSetup() {
  const view = useCalendarView();
  const navigation = useCalendarNavigation();
  const data = useCalendarOccurrenceData({
    range: () => {
      const range = navigation.visibleRange();
      return range
        ? createCalendarOccurrenceQueryRange(range.start, range.end)
        : undefined;
    },
    sourceById: view.sourceById,
    sourcesReady: view.sourcesReady,
    isSourceVisible: view.isSourceVisible,
  });
  return (
    <>
      <RangeUnavailableBanner />
      <SetupStatus data={data} allowBlocking={false} />
    </>
  );
}
