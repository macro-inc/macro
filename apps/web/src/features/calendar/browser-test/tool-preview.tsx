import '@fontsource-variable/inter';
import '../../../index.css';
import { CalendarToolEventPreview } from '@core/component/AI/component/tool/calendar/EventPreview';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { render } from 'solid-js/web';
import { createCalendarEventFormController } from '../components/composer/create-calendar-event-form-controller';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

/**
 * The agent card's day preview of a drafted event, 14:00 to 15:00 on
 * 2 January 2030, over the calendar's own sources and occurrences.
 */
function Fixture() {
  const controller = createCalendarEventFormController({
    initialValue: {
      title: 'Drafted review',
      allDay: false,
      start: '2030-01-02T14:00',
      end: '2030-01-02T15:00',
      recurrenceLines: [],
      guests: '',
      location: '',
      description: '',
      conference: 'none',
      calendarId: 'calendar-1',
    },
    calendarOptions: () => [
      { id: 'calendar-1', label: 'Calendar', color: '#609fe2' },
    ],
    guestOptions: () => [],
  });
  return (
    <main class="flex h-dvh flex-col bg-page p-4 text-ink">
      <CalendarToolEventPreview
        controller={controller}
        eventId="drafted-review"
        class="h-[480px]"
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
