import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import { useCalendarSearchPreviewsQuery } from '@queries/calendar/mention-preview';
import { queryReadyGate } from '@queries/gate';
import type { CalendarMentionEvent } from '@service-storage/generated/schemas/calendarMentionEvent';
import { cn } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';
import {
  type EventSchedule,
  eventSchedule,
  groupByDay,
} from '../core/event-time';
import type { AgendaEventRef } from '../core/types';
import { eventDetail, eventOpenTarget } from './event-card';

/** Rows an agenda shows before the rest fold behind "Show more". */
export const AGENDA_ROWS = 8;

type AgendaEntry = {
  ref: AgendaEventRef;
  event: CalendarMentionEvent;
  schedule: EventSchedule;
};

/**
 * A run of calendar events as a compact agenda: grouped by day, each row its
 * time, its title and one line about it. The events load from the viewer's
 * own calendars, so the times are current and an event they cannot see
 * stays hidden. A long agenda folds behind "Show more" rather than
 * scrolling inside the conversation.
 */
export function Agenda(props: {
  title?: string;
  events: readonly AgendaEventRef[];
  limit?: number;
}) {
  const query = useCalendarSearchPreviewsQuery(() =>
    props.events.map((ref) => ({
      eventId: ref.eventId,
      occurrenceKey: ref.occurrenceKey,
    }))
  );
  const [expanded, setExpanded] = createSignal(false);
  const entries = createMemo<AgendaEntry[]>(() => {
    if (!queryReadyGate(query)) return [];
    const items = query.data ?? [];
    return props.events.flatMap((ref, index) => {
      const item = items[index];
      if (item?.type !== 'access' || !item.event) return [];
      const schedule = eventSchedule(item.event.time);
      return schedule ? [{ ref, event: item.event, schedule }] : [];
    });
  });
  const hiddenCount = () =>
    queryReadyGate(query) ? props.events.length - entries().length : 0;
  const limit = () => (expanded() ? Infinity : (props.limit ?? AGENDA_ROWS));
  const days = createMemo(() => {
    let budget = limit();
    return groupByDay(entries()).flatMap((day) => {
      if (budget <= 0) return [];
      const shown = day.entries.slice(0, budget);
      budget -= shown.length;
      return [{ ...day, entries: shown }];
    });
  });
  const more = () => Math.max(0, entries().length - limit());

  return (
    <section
      aria-label={props.title ?? 'Agenda'}
      class="w-full max-w-xl min-w-0 rounded-xl border border-edge-muted bg-panel py-2 transition-opacity duration-300 starting:opacity-0"
      data-agent-agenda
    >
      <Show when={props.title}>
        {(title) => (
          <h3 class="flex items-center gap-1.5 px-3 pt-1 pb-2 text-sm font-semibold text-ink">
            <CalendarBlank class="size-4 text-ink-muted" aria-hidden="true" />
            {title()}
          </h3>
        )}
      </Show>
      <Switch>
        <Match when={query.isError}>
          <p class="px-3 py-2 text-xs text-ink-muted">
            Couldn't load these events.
          </p>
        </Match>
        <Match when={!queryReadyGate(query)}>
          <div class="flex flex-col gap-2 px-3 py-1" aria-busy="true">
            <For each={[0, 1, 2]}>
              {() => <div class="h-8 animate-pulse rounded-md bg-hover" />}
            </For>
          </div>
        </Match>
        <Match when={entries().length === 0}>
          <p class="px-3 py-2 text-xs text-ink-muted">No events to show.</p>
        </Match>
        <Match when={true}>
          <For each={days()}>
            {(day) => (
              <div class="px-1.5 pb-1">
                <h4 class="px-1.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase">
                  {day.label}
                </h4>
                <ul class="flex flex-col">
                  <For each={day.entries}>
                    {(entry) => <AgendaRow entry={entry} />}
                  </For>
                </ul>
              </div>
            )}
          </For>
          <Show when={more() > 0}>
            <button
              type="button"
              class="mx-3 mt-1 text-xs text-ink-muted hover:text-ink"
              onClick={() => setExpanded(true)}
            >
              Show {more()} more
            </button>
          </Show>
        </Match>
      </Switch>
      <Show when={hiddenCount() > 0}>
        <p class="px-3 pt-1 text-xs text-ink-extra-muted">
          {hiddenCount() === 1
            ? "1 event isn't on your calendar."
            : `${hiddenCount()} events aren't on your calendar.`}
        </p>
      </Show>
    </section>
  );
}

function AgendaRow(props: { entry: AgendaEntry }) {
  const target = () =>
    eventOpenTarget(props.entry.ref.occurrenceKey, props.entry.event);
  const detail = () => eventDetail(props.entry.event);
  return (
    <li>
      <button
        type="button"
        disabled={!target()}
        class="flex w-full min-w-0 items-stretch gap-3 rounded-lg px-1.5 py-1.5 text-left enabled:hover:bg-hover"
        onClick={(click) => {
          const open = target();
          if (open) {
            void openCalendarEventSplit({
              ...open,
              openInNewSplit: click.shiftKey,
            });
          }
        }}
      >
        <span
          class={cn(
            'w-24 shrink-0 pt-px text-xs tabular-nums',
            props.entry.schedule.past
              ? 'text-ink-extra-muted'
              : 'text-ink-muted'
          )}
        >
          {props.entry.schedule.time}
        </span>
        <span
          class={cn(
            'w-0.5 shrink-0 rounded-full',
            props.entry.schedule.past ? 'bg-edge' : 'bg-accent'
          )}
          aria-hidden="true"
        />
        <span class="flex min-w-0 flex-1 flex-col">
          <span
            class={cn(
              'truncate text-sm',
              props.entry.schedule.past ? 'text-ink-muted' : 'text-ink'
            )}
          >
            {props.entry.event.title || 'Untitled event'}
          </span>
          <Show when={detail()}>
            <span class="truncate text-xs text-ink-extra-muted">
              {detail()}
            </span>
          </Show>
        </span>
      </button>
    </li>
  );
}
