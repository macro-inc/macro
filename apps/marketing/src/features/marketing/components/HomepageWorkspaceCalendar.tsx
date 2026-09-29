import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Gear from '@phosphor/gear.svg';
import Plus from '@phosphor/plus.svg';
import { Button } from '@ui';
import { createSignal, For } from 'solid-js';
import { ViewShell } from './DemoWorkspaceChrome';

const TEAM = {
  id: 'demo-team',
  name: 'Launch team',
  color: '#6fa6d9',
};
const PERSONAL = {
  id: 'demo-personal',
  name: 'Personal',
  color: '#a98cd8',
};
const INITIAL_DATE = new Date(2026, 8, 24);
const EVENTS = [
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

/** Website-only week grid: fixture events, no app calendar or providers. */
export default function HomepageWorkspaceCalendar() {
  const [weekOffset, setWeekOffset] = createSignal(0);
  const start = () =>
    new Date(
      INITIAL_DATE.getFullYear(),
      INITIAL_DATE.getMonth(),
      INITIAL_DATE.getDate() - INITIAL_DATE.getDay() + weekOffset() * 7
    );
  const days = () =>
    Array.from(
      { length: 7 },
      (_, index) =>
        new Date(
          start().getFullYear(),
          start().getMonth(),
          start().getDate() + index
        )
    );
  const title = () =>
    new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
      start()
    );
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
          onClick={() => setWeekOffset((value) => value - 1)}
        >
          <CaretLeft class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          label="Next week"
          onClick={() => setWeekOffset((value) => value + 1)}
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
      <div class="workspace-demo-scroll" aria-label="Sample weekly calendar">
        <div class="grid grid-cols-[44px_repeat(7,minmax(0,1fr))] border-y border-edge-muted">
          <span />
          <For each={days()}>
            {(day) => (
              <div class="border-l border-edge-muted py-2 text-center text-xs text-ink-muted">
                {day.toLocaleDateString('en-US', { weekday: 'short' })}
                <span class="mx-auto mt-1 block text-base text-ink">
                  {day.getDate()}
                </span>
              </div>
            )}
          </For>
        </div>
        <div class="relative grid grid-cols-[44px_repeat(7,minmax(0,1fr))]">
          <div>
            <For each={Array.from({ length: 11 }, (_, i) => i + 8)}>
              {(hour) => (
                <div class="h-16 pr-1 text-right text-[10px] text-ink-extra-muted">
                  {hour > 12 ? hour - 12 : hour} {hour >= 12 ? 'PM' : 'AM'}
                </div>
              )}
            </For>
          </div>
          <For each={days()}>
            {(day) => (
              <div class="relative border-l border-edge-muted">
                <For each={Array.from({ length: 11 })}>
                  {() => <div class="h-16 border-b border-edge-muted" />}
                </For>
                <For
                  each={EVENTS.filter(
                    (event) =>
                      new Date(event.start).toDateString() ===
                      day.toDateString()
                  )}
                >
                  {(event) => (
                    <div
                      class="absolute inset-x-0.5 overflow-hidden rounded border-l-2 p-1 text-[10px] leading-tight"
                      style={{
                        top: `${(new Date(event.start).getHours() - 8 + new Date(event.start).getMinutes() / 60) * 64}px`,
                        height: `${((new Date(event.end).getTime() - new Date(event.start).getTime()) / 3600000) * 64}px`,
                        'border-color': event.calendar.color,
                        background: `${event.calendar.color}25`,
                        color: event.calendar.color,
                      }}
                    >
                      <span class="font-medium">{event.title}</span>
                      <br />
                      {new Date(event.start).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
    </>
  );
}
