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
import { SourceControls } from '../components/SourceControls';
import { useSetCalendarColor } from '../hooks/use-calendar-color';
import { useCalendarOccurrenceData } from '../hooks/use-calendar-occurrence-data';
import { useCalendarSources } from '../hooks/use-calendar-sources';

document.documentElement.dataset.touchDevice = String(isTouchDevice());

/**
 * The calendar sidebar's calendar list beside the week of 2 January 2030, over
 * the real calendar list, occurrence and color queries: a color picked in the
 * list reaches the calendar's events on the grid.
 */
function Fixture() {
  const { sources, sourceById, sourcesReady } = useCalendarSources();
  const setCalendarColor = useSetCalendarColor();
  const [hidden, setHidden] = createSignal<string[]>([]);
  const isVisible = (id: string) => !hidden().includes(id);
  const changeVisibility = (ids: string[], visible: boolean) =>
    setHidden((current) =>
      visible
        ? current.filter((id) => !ids.includes(id))
        : [...current.filter((id) => !ids.includes(id)), ...ids]
    );
  const [range, setRange] = createSignal<CalendarOccurrenceQueryRange>();
  const data = useCalendarOccurrenceData({
    range,
    sourceById,
    sourcesReady,
    isSourceVisible: isVisible,
  });
  return (
    <main class="flex h-dvh gap-4 bg-page p-4 text-ink">
      <aside class="w-64 shrink-0">
        <SourceControls
          sources={sources()}
          isVisible={isVisible}
          onVisibilityChange={(id, visible) => changeVisibility([id], visible)}
          onGroupVisibilityChange={changeVisibility}
          onColorChange={setCalendarColor}
        />
      </aside>
      <section class="min-w-0 flex-1">
        <CalendarEmbed
          initialDate={new Date(2030, 0, 2)}
          events={data.visibleEvents()}
          eventsById={data.eventsById()}
          settings={{
            initialView: 'timeGridWeek',
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
      </section>
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
