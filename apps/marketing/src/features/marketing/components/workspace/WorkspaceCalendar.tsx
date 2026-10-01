import CaretDown from '@phosphor/caret-down.svg';
import CaretLeft from '@phosphor/caret-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import { Button, Dropdown } from '@ui';
import { For, Show } from 'solid-js';
import {
  sampleToday,
  shiftDate,
  weekDates,
} from '../../core/workspace-fixtures';
import type { DummyWorkspace } from '../../primitives/createDummyWorkspace';
import { ViewShell } from '../DemoWorkspaceChrome';
import { WorkspaceEventDetails } from './WorkspaceEventDetails';

export function MiniCalendar(props: { workspace: DummyWorkspace }) {
  const w = props.workspace;
  const start = () => `${w.calendarDate().slice(0, 7)}-01`;
  const days = () =>
    Array.from({ length: 42 }, (_, i) =>
      shiftDate(start(), i - new Date(`${start()}T12:00:00`).getDay())
    );
  return (
    <div class="sample-mini-calendar">
      <div class="flex items-center justify-between pb-3 text-xs font-semibold">
        <span>{monthLabel(w.calendarDate())}</span>
        <Button
          size="icon-sm"
          variant="plain"
          label="Previous month"
          onClick={() => w.setCalendarDate(shiftDate(start(), -1))}
        >
          <CaretLeft />
        </Button>
        <Button
          size="icon-sm"
          variant="plain"
          label="Next month"
          onClick={() =>
            w.setCalendarDate(shiftDate(start(), 32).slice(0, 7) + '-01')
          }
        >
          <CaretRight />
        </Button>
      </div>
      <div class="sample-mini-days">
        <For each={['S', 'M', 'T', 'W', 'T', 'F', 'S']}>
          {(day) => <span class="text-ink-muted text-[10px]">{day}</span>}
        </For>
        <For each={days()}>
          {(date) => (
            <button
              type="button"
              aria-label={date}
              aria-pressed={date === w.calendarDate()}
              data-muted={date.slice(0, 7) !== start().slice(0, 7)}
              onClick={() => w.setCalendarDate(date)}
            >
              {Number(date.slice(-2))}
            </button>
          )}
        </For>
      </div>
    </div>
  );
}
function monthLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}
function timeLabel(hour: number) {
  return `${Math.floor(hour) % 12 || 12}${hour % 1 ? ':30' : ''}${hour >= 12 ? 'pm' : 'am'}`;
}
// CalendarGrid/EventContent geometry and colors frozen into a local week grid.
export function WorkspaceCalendar(props: { workspace: DummyWorkspace }) {
  const w = props.workspace;
  const dates = () =>
    w.calendarMode() === 'Week'
      ? weekDates(w.calendarDate())
      : [w.calendarDate()];
  const selected = () =>
    w.data.events.find((event) => event.id === w.selected());
  const update = (patch: Partial<NonNullable<ReturnType<typeof selected>>>) =>
    w.setData('events', (event) => event.id === w.selected(), patch);
  return (
    <>
      <ViewShell.TopBar>
        <span class="text-sm font-medium">{monthLabel(w.calendarDate())}</span>
      </ViewShell.TopBar>
      <div class="sample-calendar-toolbar">
        <Button
          variant="plain"
          size="sm"
          onClick={() => w.setCalendarDate(sampleToday)}
        >
          Today
        </Button>
        <Dropdown modal={false}>
          <Dropdown.Trigger
            aria-label="Choose calendar view"
            variant="plain"
            size="sm"
          >
            {w.calendarMode()}
            <CaretDown class="size-3" />
          </Dropdown.Trigger>
          <Dropdown.Content portalScope="local">
            <Dropdown.Group>
              <For each={['Week', 'Day'] as const}>
                {(mode) => (
                  <Dropdown.Item onSelect={() => w.setCalendarMode(mode)}>
                    {mode}
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <Button
          variant="plain"
          size="icon-sm"
          label="Previous period"
          onClick={() =>
            w.setCalendarDate(
              shiftDate(w.calendarDate(), w.calendarMode() === 'Week' ? -7 : -1)
            )
          }
        >
          <CaretLeft />
        </Button>
        <Button
          variant="plain"
          size="icon-sm"
          label="Next period"
          onClick={() =>
            w.setCalendarDate(
              shiftDate(w.calendarDate(), w.calendarMode() === 'Week' ? 7 : 1)
            )
          }
        >
          <CaretRight />
        </Button>
      </div>
      <div class="dummy-scroll sample-calendar">
        <div
          class="sample-calendar-head"
          style={{
            'grid-template-columns': `48px repeat(${dates().length},minmax(96px,1fr))`,
          }}
        >
          <span />
          <For each={dates()}>
            {(date) => (
              <div data-today={date === sampleToday}>
                <span>
                  {new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
                    weekday: 'short',
                  })}
                </span>
                <strong>{Number(date.slice(-2))}</strong>
              </div>
            )}
          </For>
        </div>
        <div
          class="sample-calendar-grid"
          style={{
            'grid-template-columns': `48px repeat(${dates().length},minmax(96px,1fr))`,
          }}
        >
          <div class="sample-time-labels">
            <For each={Array.from({ length: 13 }, (_, i) => i + 8)}>
              {(hour) => <span>{timeLabel(hour)}</span>}
            </For>
          </div>
          <For each={dates()}>
            {(date) => (
              <div class="sample-calendar-day" aria-label={`Events on ${date}`}>
                <For
                  each={w.data.events.filter(
                    (e) =>
                      e.date === date &&
                      (w.showPersonal() || e.calendar !== 'personal')
                  )}
                >
                  {(event) => (
                    <button
                      type="button"
                      class="sample-calendar-event"
                      data-personal={event.calendar === 'personal'}
                      style={{
                        top: `${(event.start - 8) * 64}px`,
                        height: `${Math.max(26, event.duration * 64 - 3)}px`,
                      }}
                      onClick={() => w.open('calendar', event.id)}
                    >
                      <strong>{event.title}</strong>
                      <span>
                        {timeLabel(event.start)}–
                        {timeLabel(event.start + event.duration)}
                      </span>
                    </button>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={selected()} keyed>
        {(event) => (
          <WorkspaceEventDetails
            event={event}
            onUpdate={update}
            onClose={() => w.open('calendar')}
          />
        )}
      </Show>
    </>
  );
}
