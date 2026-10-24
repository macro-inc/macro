import { openCalendarEventSplit } from '@app/features/calendar-view/open-calendar-event';
import { fireAndForget } from '@core/util/fireAndForget';
import CalendarBlank from '@phosphor/calendar-blank.svg';
import { useCalendarSearchPreviewsQuery } from '@queries/calendar/mention-preview';
import { queryReadyGate } from '@queries/gate';
import { cn } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { eventSchedule, groupByDay, overlaps } from '../core/event-time';
import type { AgendaEventRef } from '../core/types';
import { eventDetail, eventOpenTarget } from './event-card';
import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardHiddenCount,
} from './kit/card';
import { CardGroupHeader, Skeleton } from './kit/parts';

/** An agenda longer than this holds a fixed height and scrolls under a fade. */
const AGENDA_ROWS = 6;

/** One event on an agenda, worded and ready to show. */
export type AgendaRowView = {
  key: string;
  title: string;
  /** `3:00 – 3:30 PM`, `All day`. */
  time: string;
  past: boolean;
  /** Where, or who. */
  detail?: string;
  /** The clash this event has with another, worded: `Overlaps Hiring sync by 15 min`. */
  clash?: string;
  onOpen?: (event: MouseEvent) => void;
};

/** One day of an agenda. */
export type AgendaDayView = {
  /** `Today · Thu 9`, `Mon 13`. */
  heading: string;
  rows: AgendaRowView[];
  /** Where the present falls among today's rows; absent on other days. */
  now?: number;
};

/**
 * Calendar events as an agenda, from rows already worded: grouped by day,
 * each row its time, an accent rule and its title, past events quieter, a
 * red line at the present, and clashes flagged rather than hidden. A long
 * agenda holds a fixed height and says how much is below.
 */
export function AgendaView(props: {
  title?: string;
  days: readonly AgendaDayView[];
  state: 'loading' | 'error' | 'ready';
  /** Events on the agenda the viewer cannot see. */
  unseen?: number;
  now?: Date;
}) {
  const count = () =>
    props.days.reduce((total, day) => total + day.rows.length, 0);
  return (
    <Card
      width="standard"
      height={count() > AGENDA_ROWS ? 320 : 'auto'}
      data-agent-card="agenda"
    >
      <section
        aria-label={props.title ?? 'Agenda'}
        class="flex min-h-0 flex-1 flex-col"
      >
        <CardHeader
          center
          tile={
            <CalendarBlank
              class="size-4 flex-none text-ink-muted"
              aria-hidden="true"
            />
          }
          title={<span class="font-semibold">{props.title ?? 'Agenda'}</span>}
          trailing={
            <Show when={count() > 0}>
              <span class="text-xs text-ink-subtle">
                {count()} {count() === 1 ? 'event' : 'events'}
              </span>
            </Show>
          }
        />
        <CardBody class="gap-0 p-2">
          <Switch>
            <Match when={props.state === 'error'}>
              <p class="px-1.5 py-2 text-xs text-ink-muted">
                Couldn't load these events.
              </p>
            </Match>
            <Match when={props.state === 'loading'}>
              <div class="flex flex-col gap-2 p-1" aria-busy="true">
                <For each={[0, 1, 2]}>
                  {() => <Skeleton width="100%" height="32px" />}
                </For>
              </div>
            </Match>
            <Match when={count() === 0}>
              <p class="px-1.5 py-2 text-xs text-ink-muted">
                No events to show.
              </p>
            </Match>
            <Match when={true}>
              <For each={props.days}>
                {(day) => (
                  <div>
                    <CardGroupHeader>{day.heading}</CardGroupHeader>
                    <For each={withNow(day)}>
                      {(row) =>
                        row === 'now' ? (
                          <NowLine at={props.now ?? new Date()} />
                        ) : (
                          <AgendaRow row={row} />
                        )
                      }
                    </For>
                  </div>
                )}
              </For>
            </Match>
          </Switch>
        </CardBody>
        <Show when={count() > AGENDA_ROWS || (props.unseen ?? 0) > 0}>
          <CardFooter small>
            <Show
              when={(props.unseen ?? 0) > 0}
              fallback={<CardHiddenCount total={count()} noun="events" />}
            >
              <span class="mr-auto text-xs text-ink-subtle">
                {props.unseen === 1
                  ? "1 event isn't on your calendar"
                  : `${props.unseen} events aren't on your calendar`}
              </span>
            </Show>
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}

function withNow(day: AgendaDayView): (AgendaRowView | 'now')[] {
  if (day.now === undefined) return [...day.rows];
  return [...day.rows.slice(0, day.now), 'now', ...day.rows.slice(day.now)];
}

/** The present, as a red rule across the day. */
function NowLine(props: { at: Date }) {
  return (
    <div
      class="flex items-center gap-1.5 px-1.5 text-[11px] leading-4 font-semibold text-failure-ink"
      aria-label="Now"
    >
      {props.at.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })}
      <i class="h-px flex-1 bg-failure" />
    </div>
  );
}

function AgendaRow(props: { row: AgendaRowView }) {
  return (
    <button
      type="button"
      data-card-row
      disabled={!props.row.onOpen}
      class="grid w-full min-w-0 grid-cols-[minmax(0,124px)_2px_minmax(0,1fr)] items-stretch gap-2.5 rounded-lg p-1.5 text-left enabled:not-touch:hover:bg-hover"
      onClick={(click) => props.row.onOpen?.(click)}
    >
      <span
        class={cn(
          'truncate text-xs leading-5 whitespace-nowrap tabular-nums',
          props.row.past ? 'text-ink-disabled' : 'text-ink-muted'
        )}
      >
        {props.row.time}
      </span>
      <span
        class={cn(
          'rounded-full',
          props.row.clash
            ? 'bg-warning'
            : props.row.past
              ? 'bg-edge'
              : 'bg-accent'
        )}
        aria-hidden="true"
      />
      <span class="flex min-w-0 flex-col">
        <span
          class={cn(
            'truncate text-sm',
            props.row.past ? 'text-ink-disabled' : 'text-ink'
          )}
        >
          {props.row.title}
        </span>
        <Show
          when={props.row.clash}
          fallback={
            <Show when={props.row.detail}>
              <span class="truncate text-xs text-ink-muted">
                {props.row.detail}
              </span>
            </Show>
          }
        >
          <span class="truncate text-xs text-warning-ink">
            {props.row.clash}
          </span>
        </Show>
      </span>
    </button>
  );
}

/** `Today · Thu 9`, `Tomorrow · Fri 10`, or `Mon 13`. */
function dayHeading(day: Date, label: string): string {
  const short = `${day.toLocaleDateString('en-US', { weekday: 'short' })} ${day.getDate()}`;
  return label === 'Today' || label === 'Tomorrow' || label === 'Yesterday'
    ? `${label} · ${short}`
    : short;
}

/**
 * Calendar events as an agenda, loaded from the viewer's own calendars, so
 * the times are current and an event they cannot see stays hidden.
 */
export function Agenda(props: {
  title?: string;
  events: readonly AgendaEventRef[];
}) {
  const query = useCalendarSearchPreviewsQuery(() =>
    props.events.map((ref) => ({
      eventId: ref.eventId,
      occurrenceKey: ref.occurrenceKey,
    }))
  );
  const loaded = createMemo(() => {
    if (!queryReadyGate(query)) return [];
    const items = query.data ?? [];
    return props.events.flatMap((ref, index) => {
      const item = items[index];
      if (item?.type !== 'access' || !item.event) return [];
      const schedule = eventSchedule(item.event.time);
      return schedule ? [{ ref, event: item.event, schedule }] : [];
    });
  });
  const days = createMemo<AgendaDayView[]>(() => {
    const entries = loaded();
    const clashes = overlaps(entries.map((entry) => entry.schedule));
    const rows = entries.map((entry, index) => {
      const clash = clashes.get(index);
      const target = eventOpenTarget(entry.ref.occurrenceKey, entry.event);
      const row: AgendaRowView & { schedule: typeof entry.schedule } = {
        key: `${entry.ref.eventId}:${entry.ref.occurrenceKey ?? ''}`,
        title: entry.event.title || 'Untitled event',
        time: entry.schedule.time,
        past: entry.schedule.past,
        detail: eventDetail(entry.event),
        clash: clash
          ? `Overlaps ${entries[clash.with].event.title || 'another event'} by ${clash.minutes} min`
          : undefined,
        onOpen: target
          ? (click) =>
              fireAndForget(
                openCalendarEventSplit({
                  ...target,
                  openInNewSplit: click.shiftKey,
                }),
                'agent-cards'
              )
          : undefined,
        schedule: entry.schedule,
      };
      return row;
    });
    return groupByDay(rows).map((day) => {
      const next = day.entries.findIndex((row) => !row.past);
      return {
        heading: dayHeading(day.day, day.label),
        rows: day.entries,
        now:
          day.label === 'Today'
            ? next === -1
              ? day.entries.length
              : next
            : undefined,
      };
    });
  });

  // With no events to load the query never runs, so an empty agenda is
  // ready at once rather than loading for good.
  const state = () => {
    if (props.events.length === 0) return 'ready';
    if (query.isError) return 'error';
    return queryReadyGate(query) ? 'ready' : 'loading';
  };

  return (
    <AgendaView
      title={props.title}
      days={days()}
      state={state()}
      unseen={queryReadyGate(query) ? props.events.length - loaded().length : 0}
    />
  );
}
