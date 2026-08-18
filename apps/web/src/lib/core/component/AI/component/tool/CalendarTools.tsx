import CalendarBlank from '@phosphor-icons/core/regular/calendar-blank.svg';
import CalendarDots from '@phosphor-icons/core/regular/calendar-dots.svg';
import CalendarPlus from '@phosphor-icons/core/regular/calendar-plus.svg';
import CalendarX from '@phosphor-icons/core/regular/calendar-x.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { format, isSameDay, subDays } from 'date-fns';
import { createSignal, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type CalendarEventListItem = NamedTool<
  'ListCalendarEvents',
  'response'
>['data']['events'][number];

type ToolCalendarEvent = NamedTool<'CreateCalendarEvent', 'response'>['data'];

type ToolCalendar = NamedTool<
  'ListCalendars',
  'response'
>['data']['calendars'][number];

const formatEventTime = (
  start: string,
  end: string,
  isAllDay: boolean
): string => {
  if (isAllDay) {
    const startDate = new Date(`${start}T00:00:00`);
    const lastDate = subDays(new Date(`${end}T00:00:00`), 1);
    if (isSameDay(startDate, lastDate)) return format(startDate, 'EEE MMM d');
    return `${format(startDate, 'EEE MMM d')} – ${format(lastDate, 'EEE MMM d')}`;
  }
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (isSameDay(startsAt, endsAt)) {
    return `${format(startsAt, 'EEE MMM d, h:mm a')} – ${format(endsAt, 'h:mm a')}`;
  }
  return `${format(startsAt, 'EEE MMM d, h:mm a')} – ${format(endsAt, 'EEE MMM d, h:mm a')}`;
};

const EventDetails = (props: { event: ToolCalendarEvent }) => (
  <Tool.List>
    <Tool.ListItem icon={<CalendarBlank class="size-4" />}>
      <div class="flex min-w-0 flex-col gap-0.5">
        <span class="truncate text-xs text-ink">{props.event.title}</span>
        <span class="text-xs text-ink-extra-muted">
          {formatEventTime(
            props.event.start,
            props.event.end,
            props.event.isAllDay
          )}
        </span>
        <Show when={props.event.location}>
          <span class="truncate text-xs text-ink-extra-muted">
            {props.event.location}
          </span>
        </Show>
        <Show when={props.event.attendeeCount > 0}>
          <span class="truncate text-xs text-ink-extra-muted">
            {props.event.attendeeCount === 1
              ? '1 attendee'
              : `${props.event.attendeeCount} attendees`}
            {': '}
            {props.event.attendees.map((attendee) => attendee.email).join(', ')}
          </span>
        </Show>
        <Show when={props.event.conferenceUrl}>
          {(url) => (
            <a
              class="truncate text-xs text-accent hover:underline"
              href={url()}
              rel="noreferrer"
              target="_blank"
            >
              {url()}
            </a>
          )}
        </Show>
      </div>
    </Tool.ListItem>
  </Tool.List>
);

const mutationRenderer = (
  name: 'CreateCalendarEvent' | 'UpdateCalendarEvent',
  icon: typeof CalendarPlus,
  label: string
) =>
  createToolRenderer({
    name,
    render: (ctx) => {
      const [isExpanded, setIsExpanded] = createSignal(false);
      const event = () => ctx.response?.data as ToolCalendarEvent | undefined;
      const title = () => {
        const responseTitle = event()?.title;
        if (responseTitle) return responseTitle;
        const callTitle = (ctx.tool.data as { title?: string | null }).title;
        return callTitle ?? undefined;
      };

      return (
        <BaseTool
          icon={icon}
          renderContext={ctx.renderContext}
          type="call"
          response={
            event() && isExpanded() ? (
              <EventDetails event={event() as ToolCalendarEvent} />
            ) : undefined
          }
        >
          <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
            <span class="min-w-0 truncate">
              {label}
              <Show when={title()}>
                {(eventTitle) => (
                  <>
                    {' '}
                    <span class="text-ink">{eventTitle()}</span>
                  </>
                )}
              </Show>
            </span>
            <Tool.ResultToggle
              expanded={isExpanded()}
              onToggle={() => setIsExpanded((expanded) => !expanded)}
              showToggle={Boolean(event())}
              status={event() ? 'Done' : undefined}
            />
          </div>
        </BaseTool>
      );
    },
  });

export const createCalendarEventHandler = mutationRenderer(
  'CreateCalendarEvent',
  CalendarPlus,
  'Create calendar event'
);

export const updateCalendarEventHandler = mutationRenderer(
  'UpdateCalendarEvent',
  CalendarDots,
  'Update calendar event'
);

export const deleteCalendarEventHandler = createToolRenderer({
  name: 'DeleteCalendarEvent',
  render: (ctx) => (
    <BaseTool icon={CalendarX} renderContext={ctx.renderContext} type="call">
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
        <span class="min-w-0 truncate">Delete calendar event</span>
        <Show when={ctx.response}>
          <span class="shrink-0 text-xs text-ink-extra-muted">Deleted</span>
        </Show>
      </div>
    </BaseTool>
  ),
});

const ListEventsResponse = (props: { events: CalendarEventListItem[] }) => (
  <Tool.List>
    <For each={props.events}>
      {(event) => (
        <Tool.ListItem icon={<CalendarBlank class="size-4" />}>
          <div class="flex min-w-0 items-center justify-between gap-2">
            <span class="truncate text-xs text-ink">{event.title}</span>
            <span class="shrink-0 text-xs text-ink-extra-muted">
              {formatEventTime(event.start, event.end, event.isAllDay)}
            </span>
          </div>
        </Tool.ListItem>
      )}
    </For>
  </Tool.List>
);

export const listCalendarEventsHandler = createToolRenderer({
  name: 'ListCalendarEvents',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const events = () => ctx.response?.data.events ?? [];
    const hasResults = () => events().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = events().length;
      if (count === 0) return 'No events';
      const label = count === 1 ? '1 event' : `${count} events`;
      return ctx.response.data.truncated ? `${label}+` : label;
    };

    return (
      <BaseTool
        icon={CalendarDots}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListEventsResponse events={events()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">List calendar events</span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});

const calendarLabel = (calendar: ToolCalendar): string => {
  if (!calendar.isWritable) return 'Read-only';
  if (calendar.isPrimary) return 'Primary';
  return 'Writable';
};

const ListCalendarsResponse = (props: { calendars: ToolCalendar[] }) => (
  <Tool.List>
    <For each={props.calendars}>
      {(calendar) => (
        <Tool.ListItem icon={<CalendarBlank class="size-4" />}>
          <div class="flex min-w-0 items-center justify-between gap-2">
            <span class="truncate text-xs text-ink">
              {calendar.name}
              <span class="text-ink-extra-muted">
                {' '}
                · {calendar.emailAddress}
              </span>
            </span>
            <span class="shrink-0 text-xs text-ink-extra-muted">
              {calendarLabel(calendar)}
            </span>
          </div>
        </Tool.ListItem>
      )}
    </For>
  </Tool.List>
);

export const listCalendarsHandler = createToolRenderer({
  name: 'ListCalendars',
  render: (ctx) => {
    const [isExpanded, setIsExpanded] = createSignal(false);
    const calendars = () => ctx.response?.data.calendars ?? [];
    const hasResults = () => calendars().length > 0;
    const statusText = () => {
      if (!ctx.response) return undefined;
      const count = calendars().length;
      if (count === 0) return 'No calendars';
      return count === 1 ? '1 calendar' : `${count} calendars`;
    };

    return (
      <BaseTool
        icon={CalendarBlank}
        renderContext={ctx.renderContext}
        type="call"
        response={
          hasResults() && isExpanded() ? (
            <ListCalendarsResponse calendars={calendars()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
          <span class="min-w-0 truncate">List calendars</span>
          <Tool.ResultToggle
            expanded={isExpanded()}
            onToggle={() => setIsExpanded((expanded) => !expanded)}
            showToggle={hasResults()}
            status={statusText()}
          />
        </div>
      </BaseTool>
    );
  },
});
