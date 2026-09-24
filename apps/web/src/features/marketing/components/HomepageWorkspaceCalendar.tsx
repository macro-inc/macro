import { ViewShell } from '@app/components/view-shell/ViewShell';
import { CalendarEmbed } from '@app/features/calendar/components/CalendarEmbed';
import type { CalendarGridHandle } from '@app/features/calendar/components/CalendarGrid';
import type {
  CalendarEvent,
  CalendarSource,
} from '@app/features/calendar/types';
import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Gear from '@phosphor/gear.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createSignal } from 'solid-js';

const TEAM: CalendarSource = {
  id: 'demo-team',
  name: 'Launch team',
  color: '#6fa6d9',
};
const PERSONAL: CalendarSource = {
  id: 'demo-personal',
  name: 'Personal',
  color: '#a98cd8',
};
const INITIAL_DATE = new Date(2026, 8, 24);
const EVENTS: CalendarEvent[] = [
  { title: 'Product standup', day: 21, hour: 9, duration: 0.5, calendar: TEAM },
  { title: 'Design review', day: 21, hour: 11, duration: 1, calendar: TEAM },
  {
    title: 'Customer conversations',
    day: 22,
    hour: 10,
    duration: 1.5,
    calendar: TEAM,
  },
  {
    title: 'Lunch with Julia',
    day: 22,
    hour: 12.5,
    duration: 1,
    calendar: PERSONAL,
  },
  {
    title: 'Launch rehearsal',
    day: 23,
    hour: 9.5,
    duration: 1,
    calendar: TEAM,
  },
  { title: 'Focus time', day: 23, hour: 12, duration: 2, calendar: PERSONAL },
  {
    title: 'Launch day check-in',
    day: 24,
    hour: 9,
    duration: 0.5,
    calendar: TEAM,
  },
  { title: 'Customer demo', day: 24, hour: 11, duration: 1, calendar: TEAM },
  {
    title: 'Team retrospective',
    day: 25,
    hour: 10,
    duration: 1,
    calendar: TEAM,
  },
].map((event, index) => ({
  id: `demo-event-${index}`,
  eventId: `demo-event-${index}`,
  occurrenceKey: 'once',
  isCancelled: false,
  isReadOnly: true,
  attendees: [],
  sourceCalendarIds: [event.calendar.id],
  recurrenceLines: [],
  title: event.title,
  start: new Date(
    2026,
    8,
    event.day,
    Math.floor(event.hour),
    (event.hour % 1) * 60
  ).toISOString(),
  end: new Date(
    2026,
    8,
    event.day,
    Math.floor(event.hour + event.duration),
    ((event.hour + event.duration) % 1) * 60
  ).toISOString(),
  allDay: false,
  calendar: event.calendar,
  visibleCalendars: [event.calendar],
}));

/** Production week grid, with fixture events and no sidebar or service providers. */
export default function HomepageWorkspaceCalendar() {
  let grid: CalendarGridHandle | undefined;
  const [title, setTitle] = createSignal('September 2026');
  return (
    <>
      <ViewShell.TopBar>
        <span class="mr-auto pl-1 text-sm font-medium">{title()}</span>
        <Button variant="ghost" size="sm" disabled>
          <Plus class="size-4" />
          New event
        </Button>
        <Button variant="ghost" size="sm" disabled>
          Week
          <CaretDown class="size-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Previous week"
          onClick={() => grid?.api()?.prev()}
        >
          <CaretLeft class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Next week"
          onClick={() => grid?.api()?.next()}
        >
          <CaretRight class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Calendar settings"
          disabled
        >
          <Gear class="size-4" />
        </Button>
      </ViewShell.TopBar>
      <div class="min-h-0 flex-1">
        <CalendarEmbed
          initialDate={INITIAL_DATE}
          events={EVENTS}
          eventsById={new Map(EVENTS.map((event) => [event.id, event]))}
          settings={{
            initialView: 'timeGridWeek',
            showWeekends: true,
            weekStartsOn: 0,
            timeFormat: '12-hour',
          }}
          selection={{ color: TEAM.color }}
          onDatesSet={(info) =>
            setTitle(
              new Intl.DateTimeFormat('en-US', {
                month: 'long',
                year: 'numeric',
              }).format(info.view.currentStart)
            )
          }
        >
          {(handle) => {
            grid = handle;
            return null;
          }}
        </CalendarEmbed>
      </div>
    </>
  );
}
