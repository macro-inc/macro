import { openExternalUrl } from '@core/util/url';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import ClockIcon from '@phosphor/clock.svg';
import GlobeIcon from '@phosphor/globe.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import RepeatIcon from '@phosphor/repeat.svg';
import UserIcon from '@phosphor/user.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import { Button } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
} from '../time-format';
import type { CalendarEvent, CalendarTimeFormat } from './types';

const formatDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
});
const formatShortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const ATTENDEE_RESPONSE = {
  accepted: { label: 'Accepted', class: 'text-success' },
  declined: { label: 'Declined', class: 'text-failure' },
  tentative: { label: 'Tentative', class: 'text-warning' },
  needs_action: { label: 'No response', class: 'text-ink-extra-muted' },
} satisfies Record<AttendeeResponseStatus, { label: string; class: string }>;

function parseCalendarDate(value: string) {
  if (!isDateOnly(value)) return new Date(value);

  const [year, month, day] = value.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

const isSameLocalDate = (first: Date, second: Date) =>
  first.getFullYear() === second.getFullYear() &&
  first.getMonth() === second.getMonth() &&
  first.getDate() === second.getDate();

function formatEventSchedule(
  event: CalendarEvent,
  timeFormat: CalendarTimeFormat
) {
  const start = parseCalendarDate(event.start);
  const end = parseCalendarDate(event.end);

  if (event.allDay) {
    const inclusiveEnd = new Date(end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    return isSameLocalDate(start, inclusiveEnd)
      ? `${formatDate.format(start)} · All day`
      : `${formatShortDate.format(start)}–${formatShortDate.format(inclusiveEnd)} · All day`;
  }

  return isSameLocalDate(start, end)
    ? `${formatDate.format(start)} · ${formatCalendarTime(start, timeFormat)}–${formatCalendarTime(end, timeFormat)}`
    : `${formatDate.format(start)}, ${formatCalendarTime(start, timeFormat)}–${formatDate.format(end)}, ${formatCalendarTime(end, timeFormat)}`;
}

function safeConferenceUrl(value: string | undefined) {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function findOrganizer(event: CalendarEvent) {
  const organizerAttendee = event.attendees.find(
    (attendee) => attendee.isOrganizer
  );
  const name =
    event.organizerName ??
    organizerAttendee?.displayName ??
    event.organizerEmail ??
    organizerAttendee?.email;
  const email = event.organizerEmail ?? organizerAttendee?.email;

  return name ? { name, email } : undefined;
}

function formatOriginalTimeZone(
  event: CalendarEvent,
  timeFormat: CalendarTimeFormat
) {
  if (event.allDay || !event.timeZone) return undefined;

  try {
    const time = new Intl.DateTimeFormat(undefined, {
      ...CALENDAR_TIME_FORMAT_OPTIONS[timeFormat],
      timeZone: event.timeZone,
      timeZoneName: 'short',
    }).format(parseCalendarDate(event.start));
    return `Original time: ${time} · ${event.timeZone}`;
  } catch {
    return `Original timezone: ${event.timeZone}`;
  }
}

/** Displays read-only details for a selected calendar event. */
export function EventDetails(props: {
  event: CalendarEvent;
  timeFormat: CalendarTimeFormat;
}) {
  const conferenceUrl = createMemo(() =>
    safeConferenceUrl(props.event.conferenceUrl)
  );
  const organizer = createMemo(() => findOrganizer(props.event));
  const originalTimeZone = createMemo(() =>
    formatOriginalTimeZone(props.event, props.timeFormat)
  );
  const isRecurring = () =>
    props.event.recurrenceLines.length > 0 ||
    props.event.recurrenceId !== undefined;

  return (
    <div class="min-w-0 p-1 text-ink">
      <div class="flex items-start gap-2">
        <div
          aria-hidden="true"
          class="mt-1 size-2.5 shrink-0 rounded-sm"
          style={{ 'background-color': props.event.calendar.color }}
        />
        <div class="min-w-0 flex-1">
          <div class="text-sm font-semibold leading-snug text-ink">
            {props.event.title}
          </div>

          <Show when={conferenceUrl()}>
            {(url) => (
              <Button
                fullWidth
                variant="cta"
                size="sm"
                class="mt-3 h-7 rounded-lg"
                label="Join meeting"
                onClick={() => openExternalUrl(url())}
              >
                <VideoCameraIcon class="size-3.5" />
                Join meeting
              </Button>
            )}
          </Show>

          <div class="mt-3 flex flex-col gap-2 text-xs text-ink-muted">
            <div class="flex items-start gap-2">
              <Show
                when={props.event.allDay}
                fallback={
                  <ClockIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                }
              >
                <CalendarIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
              </Show>
              <span>{formatEventSchedule(props.event, props.timeFormat)}</span>
            </div>

            <Show when={originalTimeZone()}>
              {(timeZone) => (
                <div class="flex items-start gap-2">
                  <GlobeIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                  <span>{timeZone()}</span>
                </div>
              )}
            </Show>

            <Show when={isRecurring()}>
              <div class="flex items-start gap-2">
                <RepeatIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                <span>Recurring event</span>
              </div>
            </Show>

            <Show when={props.event.location}>
              {(location) => (
                <div class="flex items-start gap-2">
                  <MapPinIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                  <span>{location()}</span>
                </div>
              )}
            </Show>

            <Show when={organizer()}>
              {(eventOrganizer) => (
                <div class="flex items-start gap-2">
                  <UserIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                  <div class="min-w-0">
                    <div class="text-[0.6875rem] text-ink-extra-muted">
                      Organizer
                    </div>
                    <div class="truncate text-ink-muted">
                      {eventOrganizer().name}
                    </div>
                    <Show
                      when={
                        eventOrganizer().email &&
                        eventOrganizer().email !== eventOrganizer().name
                      }
                    >
                      <div class="truncate text-[0.6875rem] text-ink-extra-muted">
                        {eventOrganizer().email}
                      </div>
                    </Show>
                  </div>
                </div>
              )}
            </Show>

            <Show when={props.event.attendees.length > 0}>
              <div class="flex items-start gap-2">
                <UsersIcon class="mt-0.5 size-3.5 shrink-0 text-ink-extra-muted" />
                <div class="min-w-0 flex-1">
                  <div>
                    {props.event.attendees.length}{' '}
                    {props.event.attendees.length === 1
                      ? 'attendee'
                      : 'attendees'}
                  </div>
                  <div class="mt-1.5 flex max-h-40 flex-col gap-1.5 overflow-y-auto pr-1">
                    <For each={props.event.attendees}>
                      {(attendee) => {
                        const response =
                          ATTENDEE_RESPONSE[attendee.responseStatus];
                        const name = attendee.displayName ?? attendee.email;

                        return (
                          <div class="flex min-w-0 items-start gap-2">
                            <div class="min-w-0 flex-1">
                              <div class="flex min-w-0 items-center gap-1">
                                <span class="truncate text-ink-muted">
                                  {name}
                                  <Show when={attendee.isSelf}> (you)</Show>
                                </span>
                                <Show when={attendee.isOrganizer}>
                                  <span class="shrink-0 text-[0.625rem] text-ink-extra-muted">
                                    Organizer
                                  </span>
                                </Show>
                                <Show when={attendee.isOptional}>
                                  <span class="shrink-0 text-[0.625rem] text-ink-extra-muted">
                                    Optional
                                  </span>
                                </Show>
                              </div>
                              <Show
                                when={
                                  attendee.displayName &&
                                  attendee.displayName !== attendee.email
                                }
                              >
                                <div class="truncate text-[0.6875rem] text-ink-extra-muted">
                                  {attendee.email}
                                </div>
                              </Show>
                              <Show when={attendee.comment}>
                                {(comment) => (
                                  <div class="line-clamp-2 text-[0.6875rem] italic text-ink-extra-muted">
                                    {comment()}
                                  </div>
                                )}
                              </Show>
                            </div>
                            <span
                              class={`shrink-0 text-[0.6875rem] ${response.class}`}
                            >
                              {response.label}
                            </span>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>
            </Show>

            <div class="flex items-center gap-2">
              <span
                aria-hidden="true"
                class="size-2 shrink-0 rounded-sm"
                style={{ 'background-color': props.event.calendar.color }}
              />
              <span>{props.event.calendar.name}</span>
            </div>
          </div>

          <Show when={props.event.description}>
            {(description) => (
              <p class="mt-3 border-t border-edge-muted pt-3 text-xs leading-relaxed text-ink-muted">
                {description()}
              </p>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
