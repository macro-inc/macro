import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { emailToMacroId, useDisplayName } from '@core/user';
import { plural } from '@core/util/string';
import { openExternalUrl } from '@core/util/url';
import { Collapsible } from '@kobalte/core/collapsible';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GlobeIcon from '@phosphor/globe.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import QuestionMarkIcon from '@phosphor/question-mark.svg';
import TextAlignLeftIcon from '@phosphor/text-align-left.svg';
import PersonIcon from '@phosphor/user.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import { Button } from '@ui';
import { type Accessor, createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
} from '../time-format';
import { formatRecurrenceDescription } from './recurrence-description';
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
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const isDateOnly = (value: string) => DATE_ONLY_REGEX.test(value);

const ATTENDEE_RESPONSE = {
  accepted: {
    label: 'Accepted',
    class: 'text-success',
    icon: CheckIcon,
  },
  declined: {
    label: 'Declined',
    class: 'text-failure',
    icon: XIcon,
  },
  tentative: {
    label: 'Tentative',
    class: 'text-warning',
    icon: QuestionMarkIcon,
  },
} satisfies Record<
  Exclude<AttendeeResponseStatus, 'needs_action'>,
  { label: string; class: string; icon: typeof CheckIcon }
>;

function isUsableDisplayName(value: string, email: string) {
  return value !== '' && value !== email && !value.includes('@');
}

interface ResolvedCalendarAttendee {
  attendee: CalendarAttendee;
  displayName: Accessor<string>;
  iconProps: UserIconProps;
}

const compareAttendeeNames = new Intl.Collator(undefined, {
  sensitivity: 'base',
}).compare;

function resolveCalendarAttendee(
  attendee: CalendarAttendee
): ResolvedCalendarAttendee {
  const macroId = emailToMacroId(attendee.email);
  const [macroDisplayName] = useDisplayName(macroId);
  const iconProps: UserIconProps = macroId
    ? { id: macroId }
    : { email: attendee.email };
  const displayName = () => {
    const macroName = macroDisplayName().trim();
    return isUsableDisplayName(macroName, attendee.email)
      ? macroName
      : attendee.email;
  };

  return { attendee, displayName, iconProps };
}

function CalendarAttendeeItem(props: { item: ResolvedCalendarAttendee }) {
  const response =
    props.item.attendee.responseStatus === 'needs_action'
      ? undefined
      : ATTENDEE_RESPONSE[props.item.attendee.responseStatus];
  const hasSecondaryLabel =
    props.item.attendee.isOrganizer || props.item.attendee.isOptional;

  return (
    <div class="flex min-w-0 items-center gap-3">
      <UserIcon
        {...props.item.iconProps}
        isDeleted={false}
        size="md"
        suppressClick
        showTooltip={false}
      />
      <div class="min-w-0 flex-1">
        <div class="min-w-0">
          <span class="block select-text truncate text-ink-muted">
            {props.item.displayName()}
            <Show when={props.item.attendee.isSelf}> (you)</Show>
          </span>
        </div>
        <Show when={hasSecondaryLabel}>
          <div class="flex gap-1 text-xxs text-ink-extra-muted">
            <Show when={props.item.attendee.isOrganizer}>
              <span>Organizer</span>
            </Show>
            <Show when={props.item.attendee.isOptional}>
              <span>Optional</span>
            </Show>
          </div>
        </Show>
        <Show when={props.item.attendee.comment}>
          {(comment) => (
            <div class="line-clamp-2 select-text text-xxs italic text-ink-extra-muted">
              {comment()}
            </div>
          )}
        </Show>
      </div>
      <Show when={response}>
        {(attendeeResponse) => (
          <span
            role="img"
            aria-label={attendeeResponse().label}
            title={attendeeResponse().label}
            class={`shrink-0 ${attendeeResponse().class}`}
          >
            <Dynamic
              component={attendeeResponse().icon}
              aria-hidden="true"
              class="size-3.5"
            />
          </span>
        )}
      </Show>
    </div>
  );
}

function CalendarAttendeeList(props: { attendees: CalendarAttendee[] }) {
  const attendees = props.attendees.map(resolveCalendarAttendee);
  const sortedAttendees = createMemo(() =>
    attendees
      .map((item) => ({ item, name: item.displayName() }))
      .toSorted(
        (first, second) =>
          compareAttendeeNames(first.name, second.name) ||
          compareAttendeeNames(
            first.item.attendee.email,
            second.item.attendee.email
          )
      )
      .map(({ item }) => item)
  );

  return (
    <For each={sortedAttendees()}>
      {(item) => <CalendarAttendeeItem item={item} />}
    </For>
  );
}

function ScrollableAttendeeList(props: { attendees: CalendarAttendee[] }) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLDivElement>();

  return (
    <div class="relative min-w-0 flex-1">
      <div ref={setScrollContainer} class="max-h-40 overflow-y-auto pr-4">
        <div class="flex flex-col gap-3">
          <CalendarAttendeeList attendees={props.attendees} />
        </div>
      </div>
      <ScrollIndicators scrollRef={scrollContainer} appearance="gradient" />
    </div>
  );
}

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
  return name;
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
  const recurrenceDescription = createMemo(() => {
    const description = formatRecurrenceDescription(
      props.event.recurrenceLines
    );
    if (description) return description;

    return props.event.recurrenceLines.length > 0 ||
      props.event.recurrenceId !== undefined
      ? 'Recurring event'
      : undefined;
  });

  return (
    <div class="min-w-0 p-1 text-ink">
      <div class="flex items-start gap-3">
        <span
          aria-hidden="true"
          class="mt-0.5 flex size-4 shrink-0 items-center justify-center"
        >
          <span
            class="size-2.5 rounded-sm"
            style={{ 'background-color': props.event.calendar.color }}
          />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-col gap-1 pr-8">
            <div class="select-text text-base font-semibold leading-snug text-ink">
              {props.event.title}
            </div>
            <div class="select-text text-xs text-ink-muted">
              {formatEventSchedule(props.event, props.timeFormat)}
            </div>
            <Show when={recurrenceDescription()}>
              {(description) => (
                <div class="select-text text-xs text-ink-extra-muted">
                  {description()}
                </div>
              )}
            </Show>
          </div>

          <div class="mt-5 flex flex-col gap-3 text-xs text-ink-muted">
            <Show when={conferenceUrl()}>
              {(url) => (
                <div class="-ml-7 flex items-center gap-3">
                  <VideoCameraIcon class="size-4 shrink-0 text-ink-extra-muted" />
                  <Button
                    fullWidth
                    variant="cta"
                    size="sm"
                    class="h-8 rounded-lg"
                    label="Join meeting"
                    onClick={() => openExternalUrl(url())}
                  >
                    Join meeting
                    <ArrowSquareOutIcon class="size-3.5" />
                  </Button>
                </div>
              )}
            </Show>
            <Show when={originalTimeZone()}>
              {(timeZone) => (
                <div class="-ml-7 flex items-start gap-3">
                  <GlobeIcon class="mt-0.5 size-4 shrink-0 text-ink-extra-muted" />
                  <span class="select-text">{timeZone()}</span>
                </div>
              )}
            </Show>

            <Show when={props.event.location}>
              {(location) => (
                <div class="-ml-7 flex items-start gap-3">
                  <MapPinIcon class="mt-0.5 size-4 shrink-0 text-ink-extra-muted" />
                  <span class="select-text">{location()}</span>
                </div>
              )}
            </Show>

            <Show when={props.event.description}>
              {(description) => (
                <div class="-ml-7 flex items-start gap-3">
                  <TextAlignLeftIcon class="mt-0.5 size-4 shrink-0 text-ink-extra-muted" />
                  <p class="select-text leading-relaxed text-ink-muted">
                    {description()}
                  </p>
                </div>
              )}
            </Show>

            <Show when={organizer()}>
              {(eventOrganizer) => (
                <div class="-ml-7 flex items-start gap-3">
                  <PersonIcon class="mt-0.5 size-4 shrink-0 text-ink-extra-muted" />
                  <div class="min-w-0">
                    <div class="text-xxs text-ink-extra-muted">Organizer</div>
                    <div class="select-text truncate text-ink-muted">
                      {eventOrganizer()}
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Displays attendees in a full-width collapsible popover section. */
export function EventAttendeesSection(props: {
  attendees: CalendarAttendee[];
}) {
  return (
    <Show when={props.attendees.length > 0}>
      <Collapsible
        defaultOpen
        class="border-edge-muted border-t text-xs text-ink-muted"
      >
        <Collapsible.Trigger class="group flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-hover hover:text-ink">
          <UsersIcon class="size-4 shrink-0 text-ink-extra-muted" />
          <span>
            {props.attendees.length}{' '}
            {plural('attendee', props.attendees.length)}
          </span>
          <CaretDownIcon
            aria-hidden="true"
            class="ml-auto size-3 shrink-0 -rotate-90 text-ink-extra-muted transition-transform group-data-expanded:rotate-0"
          />
        </Collapsible.Trigger>
        <Collapsible.Content class="data-closed:hidden">
          <div class="flex gap-3 pb-3 pl-4 pt-1.5">
            <span aria-hidden="true" class="size-4 shrink-0" />
            <ScrollableAttendeeList attendees={props.attendees} />
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  );
}
