import CalendarBlank from '@phosphor-icons/core/regular/calendar-blank.svg';
import CalendarDots from '@phosphor-icons/core/regular/calendar-dots.svg';
import CalendarPlus from '@phosphor-icons/core/regular/calendar-plus.svg';
import CalendarX from '@phosphor-icons/core/regular/calendar-x.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { format, isSameDay, subDays } from 'date-fns';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { CalendarChatCompose } from './calendar/ChatCompose';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type CalendarEventListItem = NamedTool<
  'ListCalendarEvents',
  'response'
>['data']['events'][number];

type ToolCalendarEvent = NamedTool<'UpdateCalendarEvent', 'response'>['data'];
type CreateCalendarEventResponse = NamedTool<
  'CreateCalendarEvent',
  'response'
>['data'];

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

function createdEvent(
  response: CreateCalendarEventResponse | undefined
): ToolCalendarEvent | undefined {
  return typeof response === 'object' &&
    response !== null &&
    'UserAction' in response
    ? response.UserAction
    : undefined;
}

function CalendarMutationCard(props: {
  event?: ToolCalendarEvent;
  icon: typeof CalendarPlus;
  label: string;
  renderContext: Parameters<typeof BaseTool>[0]['renderContext'];
  status?: string;
  title?: string;
}) {
  const [isExpanded, setIsExpanded] = createSignal(false);
  const title = () => props.event?.title ?? props.title;

  return (
    <BaseTool
      icon={props.icon}
      renderContext={props.renderContext}
      type="call"
      response={
        props.event && isExpanded() ? (
          <EventDetails event={props.event} />
        ) : undefined
      }
    >
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
        <span class="min-w-0 truncate">
          {props.label}
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
          showToggle={props.event !== undefined}
          status={props.event ? 'Done' : props.status}
        />
      </div>
    </BaseTool>
  );
}

export const createCalendarEventHandler = createToolRenderer({
  name: 'CreateCalendarEvent',
  render: (ctx) => {
    const response = () => ctx.response?.data;
    const event = () => createdEvent(response());

    return (
      <Switch
        fallback={
          <CalendarMutationCard
            icon={CalendarPlus}
            label="Create calendar event"
            renderContext={ctx.renderContext}
            title={ctx.tool.data.title}
          />
        }
      >
        <Match when={response() === 'PendingUserExecution'}>
          <CalendarChatCompose
            chatId={ctx.chat_id}
            initialData={ctx.tool.data}
            messageId={ctx.message_id}
            streamLocked={ctx.renderContext.isStreaming}
            toolCallId={ctx.tool.id}
          />
        </Match>
        <Match when={response() === 'Rejected'}>
          <CalendarMutationCard
            icon={CalendarPlus}
            label="Create calendar event"
            renderContext={ctx.renderContext}
            status="Canceled"
            title={ctx.tool.data.title}
          />
        </Match>
        <Match when={event()}>
          {(created) => (
            <CalendarMutationCard
              event={created()}
              icon={CalendarPlus}
              label="Create calendar event"
              renderContext={ctx.renderContext}
            />
          )}
        </Match>
      </Switch>
    );
  },
});

export const updateCalendarEventHandler = createToolRenderer({
  name: 'UpdateCalendarEvent',
  render: (ctx) => {
    const scope = () => ctx.tool.data.scope;
    return (
      <CalendarMutationCard
        event={ctx.response?.data}
        icon={CalendarDots}
        label={
          scope() === 'this_event'
            ? 'Update calendar event occurrence'
            : 'Update calendar event'
        }
        renderContext={ctx.renderContext}
        title={ctx.tool.data.title ?? undefined}
      />
    );
  },
});

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
