import '@fontsource-variable/inter';
import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { CalendarEmbed } from '../components/CalendarEmbed';
import { useCalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import type { CalendarPeriodView } from '../types';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

const params = new URLSearchParams(location.search);
const VIEW: CalendarPeriodView =
  params.get('view') === 'month' ? 'dayGridMonth' : 'timeGridWeek';

/**
 * The calendar's grid over the calendar's own occurrence data: the range the
 * grid shows is the range read, as on the calendar page. `?view=month` shows
 * the month, otherwise the week, of 2 January 2030.
 */
function Fixture() {
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const data = useCalendarOccurrenceData({ range });
  return (
    <main class="h-dvh bg-page p-4 text-ink">
      <CalendarEmbed
        initialDate={new Date(2030, 0, 2)}
        events={data.visibleEvents()}
        eventsById={data.eventsById()}
        settings={{
          initialView: VIEW,
          showDayHeaders: true,
          showWeekends: true,
          weekStartsOn: 0,
          timeFormat: '12-hour',
        }}
        selection={{ color: '#609fe2' }}
        onDatesSet={(info) =>
          setRange(createCalendarOccurrenceQueryRange(info.start, info.end))
        }
      />
    </main>
  );
}

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>
    ),
    root
  );
