import CalendarIcon from '@phosphor/calendar-blank.svg';
import VideoIcon from '@phosphor/video-camera.svg';
import { Key } from '@solid-primitives/keyed';
import { format, isSameDay, parseISO, subDays } from 'date-fns';
import { createMemo, Show } from 'solid-js';
import {
  type CalendarAgendaEvent,
  groupAgendaEvents,
} from '../core/calendar-agenda';

export function CalendarAgenda(props: {
  events: readonly CalendarAgendaEvent[];
  use24HourTime: boolean;
  loading: boolean;
  rangeStart?: Date;
  onSelect: (id: string, anchor: HTMLElement) => void;
}) {
  const groups = createMemo(() =>
    groupAgendaEvents(props.events, props.rangeStart)
  );
  const time = (value: string) =>
    format(parseISO(value), props.use24HourTime ? 'HH:mm' : 'h:mm a');
  const timeLabels = (event: CalendarAgendaEvent) => {
    const start = parseISO(event.start);
    const end = event.allDay
      ? subDays(parseISO(event.end), 1)
      : parseISO(event.end);
    if (event.allDay)
      return isSameDay(start, end)
        ? ['All day']
        : [format(start, 'MMM d'), `– ${format(end, 'MMM d')}`];
    return isSameDay(start, end)
      ? [time(event.start), time(event.end)]
      : [
          `${format(start, 'MMM d')}, ${time(event.start)}`,
          `${format(end, 'MMM d')}, ${time(event.end)}`,
        ];
  };
  return (
    <div class="size-full overflow-y-auto px-4 py-2" aria-label="Event list">
      <Show
        when={groups().length > 0}
        fallback={
          <div class="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-ink-muted">
            <CalendarIcon class="size-7 text-ink-extra-muted" />
            <p class="text-sm">
              {props.loading ? 'Loading events…' : 'No events in this period'}
            </p>
          </div>
        }
      >
        <Key each={groups()} by="day">
          {(group) => (
            <section class="py-3">
              <h2 class="sticky top-0 z-1 bg-panel py-2 text-xs font-medium text-ink-muted">
                {format(parseISO(group().day), 'EEEE, MMMM d')}
              </h2>
              <div class="divide-y divide-edge-muted rounded-lg border border-edge-muted">
                <Key each={group().events} by="id">
                  {(event) => (
                    <button
                      type="button"
                      class="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-hover"
                      onClick={(e) =>
                        props.onSelect(event().id, e.currentTarget)
                      }
                    >
                      <span
                        class="h-8 w-1 shrink-0 rounded-full"
                        style={{ 'background-color': event().color }}
                      />
                      <span class="w-24 shrink-0 text-xs text-ink-muted">
                        {timeLabels(event())[0]}
                        <Show when={timeLabels(event())[1]}>
                          <span class="block text-ink-extra-muted">
                            {timeLabels(event())[1]}
                          </span>
                        </Show>
                      </span>
                      <span class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="truncate text-sm font-medium text-ink">
                          {event().title || 'Untitled event'}
                        </span>
                        <span class="truncate text-xs text-ink-extra-muted">
                          {event().calendar}
                        </span>
                      </span>
                      <Show when={event().hasCall}>
                        <span title="Includes a call" class="text-ink-muted">
                          <VideoIcon
                            class="size-4"
                            aria-label="Includes a call"
                          />
                        </span>
                      </Show>
                    </button>
                  )}
                </Key>
              </div>
            </section>
          )}
        </Key>
      </Show>
    </div>
  );
}
