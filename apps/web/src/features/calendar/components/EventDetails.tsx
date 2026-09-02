import { UserIcon, type UserIconProps } from '@core/component/UserIcon';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import {
  emailToMacroId,
  getDisplayName,
  getInitialsFromName,
} from '@core/user';
import { plural } from '@core/util/string';
import { openExternalUrl } from '@core/util/url';
import { Collapsible } from '@kobalte/core/collapsible';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import GlobeIcon from '@phosphor/globe.svg';
import MapPinIcon from '@phosphor/map-pin.svg';
import PhoneIcon from '@phosphor/phone.svg';
import QuestionMarkIcon from '@phosphor/question-mark.svg';
import TextAlignLeftIcon from '@phosphor/text-align-left.svg';
import PersonIcon from '@phosphor/user.svg';
import UsersIcon from '@phosphor/users.svg';
import VideoCameraIcon from '@phosphor/video-camera.svg';
import XIcon from '@phosphor/x.svg';
import type { AttendeeResponseStatus } from '@service-storage/generated/schemas/attendeeResponseStatus';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { EventReminderOverride } from '@service-storage/generated/schemas/eventReminderOverride';
import { Avatar, Button, cn } from '@ui';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { CalendarEvent, CalendarTimeFormat } from '../types';
import { isSameLocalDate, parseLocalDate } from '../utils/calendar-date';
import {
  type CalendarPerson,
  eventAttribution,
} from '../utils/event-attribution';
import {
  isPhoneOnlyLocation,
  parseEventLocation,
} from '../utils/event-location';
import {
  formatReminderOffset,
  REMINDER_METHOD_POPUP,
  resolveReminderOverrides,
} from '../utils/event-reminders';
import { formatRecurrenceDescription } from '../utils/recurrence';
import {
  CALENDAR_TIME_FORMAT_OPTIONS,
  formatCalendarTime,
} from '../utils/time-format';

const formatDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'long',
  day: 'numeric',
});
const formatShortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});
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
  const iconProps: UserIconProps = macroId
    ? { id: macroId }
    : { email: attendee.email };
  const displayName = () => {
    const macroName = getDisplayName(macroId).trim();
    return isUsableDisplayName(macroName, attendee.email)
      ? macroName
      : attendee.email;
  };

  return { attendee, displayName, iconProps };
}

function CalendarUserItem(props: {
  displayName: Accessor<string>;
  iconProps?: UserIconProps;
  isSelf: boolean;
  secondaryLabel?: JSX.Element;
  secondaryLabelPosition?: 'above' | 'below';
  details?: JSX.Element;
  trailing?: JSX.Element;
  nameClass?: string;
}) {
  const secondaryLabelPosition = () => props.secondaryLabelPosition ?? 'below';

  return (
    <div class="flex min-w-0 items-center gap-4 sm:gap-3">
      <Show
        keyed
        when={props.iconProps}
        fallback={
          <Avatar size="md">
            <Avatar.Fallback class="font-semibold">
              {getInitialsFromName(props.displayName(), '')}
            </Avatar.Fallback>
          </Avatar>
        }
      >
        {(iconProps) => (
          <UserIcon
            {...iconProps}
            isDeleted={false}
            size="md"
            suppressClick
            showTooltip={false}
          />
        )}
      </Show>
      <div class="min-w-0 flex-1">
        <Show
          when={secondaryLabelPosition() === 'above' && props.secondaryLabel}
        >
          <div class="flex gap-1 text-xs text-ink-extra-muted sm:text-xxs">
            {props.secondaryLabel}
          </div>
        </Show>
        <span
          class={cn(
            'block select-text truncate text-ink-muted',
            props.nameClass
          )}
        >
          {props.displayName()}
          <Show when={props.isSelf}> (you)</Show>
        </span>
        <Show
          when={secondaryLabelPosition() === 'below' && props.secondaryLabel}
        >
          <div class="flex gap-1 text-xs text-ink-extra-muted sm:text-xxs">
            {props.secondaryLabel}
          </div>
        </Show>
        {props.details}
      </div>
      {props.trailing}
    </div>
  );
}

function CalendarAttendeeItem(props: {
  item: ResolvedCalendarAttendee;
  nameClass?: string;
}) {
  const attendee = props.item.attendee;
  const response =
    attendee.responseStatus === 'needs_action'
      ? undefined
      : ATTENDEE_RESPONSE[attendee.responseStatus];
  const secondaryLabel =
    attendee.isOrganizer || attendee.isOptional ? (
      <>
        <Show when={attendee.isOrganizer}>
          <span>Organizer</span>
        </Show>
        <Show when={attendee.isOptional}>
          <span>Optional</span>
        </Show>
      </>
    ) : undefined;
  const details = attendee.comment ? (
    <div class="line-clamp-2 select-text text-xs italic text-ink-extra-muted sm:text-xxs">
      {attendee.comment}
    </div>
  ) : undefined;
  const trailing = response ? (
    <span
      role="img"
      aria-label={response.label}
      title={response.label}
      class={`shrink-0 ${response.class}`}
    >
      <Dynamic component={response.icon} aria-hidden="true" class="size-3.5" />
    </span>
  ) : undefined;

  return (
    <CalendarUserItem
      displayName={props.item.displayName}
      iconProps={props.item.iconProps}
      isSelf={attendee.isSelf}
      secondaryLabel={secondaryLabel}
      details={details}
      trailing={trailing}
      nameClass={props.nameClass}
    />
  );
}

interface CalendarAttendeeListProps {
  attendees: CalendarAttendee[];
  organizerFirst?: boolean;
  itemClass?: (attendee: CalendarAttendee) => string | undefined;
  nameClass?: string;
}

/** Resolved attendee rows shared by event details and read-only guest views. */
function CalendarAttendeeList(props: CalendarAttendeeListProps) {
  const sortedAttendees = createMemo(() =>
    props.attendees
      .map(resolveCalendarAttendee)
      .map((item) => ({ item, name: item.displayName() }))
      .toSorted((first, second) => {
        if (
          props.organizerFirst &&
          first.item.attendee.isOrganizer !== second.item.attendee.isOrganizer
        ) {
          return first.item.attendee.isOrganizer ? -1 : 1;
        }
        return (
          compareAttendeeNames(first.name, second.name) ||
          compareAttendeeNames(
            first.item.attendee.email,
            second.item.attendee.email
          )
        );
      })
      .map(({ item }) => item)
  );

  return (
    <For each={sortedAttendees()}>
      {(item) => (
        <div class={cn(props.itemClass?.(item.attendee))}>
          <CalendarAttendeeItem item={item} nameClass={props.nameClass} />
        </div>
      )}
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
  return parseLocalDate(value) ?? new Date(value);
}

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

/**
 * The location row. A phone number written into the location becomes a call
 * link, so a dial-in number takes one click instead of being retyped into a
 * phone by hand.
 */
function EventLocationItem(props: { location: string }) {
  const segments = createMemo(() => parseEventLocation(props.location));

  return (
    <div class="contents">
      <Dynamic
        aria-hidden="true"
        class="mt-0.5 size-5 text-ink-extra-muted sm:size-4"
        component={isPhoneOnlyLocation(segments()) ? PhoneIcon : MapPinIcon}
      />
      <span class="select-text">
        <For each={segments()}>
          {(segment) =>
            segment.kind === 'phone' ? (
              <a
                class="text-link hover:text-link-hover hover:underline"
                href={segment.telUrl}
              >
                {segment.text}
              </a>
            ) : (
              segment.text
            )
          }
        </For>
      </span>
    </div>
  );
}

/**
 * The reminders the event resolves to, one line each: its own overrides when
 * it departed from the calendar defaults, the calendar defaults otherwise.
 * Nothing renders while the calendar (and so its defaults) is unknown.
 */
function EventRemindersItem(props: {
  event: CalendarEvent;
  defaultReminders?: EventReminderOverride[];
}) {
  const reminders = createMemo(() =>
    resolveReminderOverrides(
      props.event.reminders,
      props.defaultReminders,
      props.event.eventType
    ).toSorted((a, b) => a.minutes - b.minutes)
  );

  return (
    <Show when={reminders().length > 0}>
      <div class="contents">
        <BellSimpleIcon class="mt-0.5 size-5 text-ink-extra-muted sm:size-4" />
        <div class="flex select-text flex-col gap-0.5">
          <For each={reminders()}>
            {(reminder) => (
              <span>
                {formatReminderOffset(reminder.minutes)}
                {reminder.method === REMINDER_METHOD_POPUP ? '' : ' (email)'}
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}

function calendarPersonDisplayName(person: CalendarPerson) {
  const email = person.email ?? '';
  const macroId = person.email ? emailToMacroId(person.email) : undefined;
  const macroName = getDisplayName(macroId).trim();
  if (isUsableDisplayName(macroName, email)) return macroName;

  const providerName = person.displayName?.trim() ?? '';
  if (providerName && (!email || isUsableDisplayName(providerName, email))) {
    return providerName;
  }

  return email || providerName;
}

function CalendarSourceItem(props: {
  calendarName: string;
  creator?: CalendarPerson;
}) {
  const createdBy = () =>
    props.creator ? calendarPersonDisplayName(props.creator) : undefined;

  return (
    <div class="contents">
      <CalendarBlankIcon class="mt-0.5 size-5 text-ink-extra-muted sm:size-4" />
      <div class="min-w-0">
        <span class="block select-text truncate text-ink-muted">
          {props.calendarName}
        </span>
        <Show when={createdBy()}>
          {(name) => (
            <div class="text-xs text-ink-extra-muted sm:text-xxs">
              Created by: {name()}
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}

function CalendarOrganizerItem(props: { organizer: CalendarPerson }) {
  const macroId = props.organizer.email
    ? emailToMacroId(props.organizer.email)
    : undefined;
  const displayName = () => calendarPersonDisplayName(props.organizer);

  const iconProps: UserIconProps | undefined = props.organizer.email
    ? macroId
      ? { id: macroId }
      : { email: props.organizer.email }
    : undefined;

  return (
    <div class="contents">
      <PersonIcon class="size-5 self-center text-ink-extra-muted sm:size-4" />
      <div class="min-w-0">
        <CalendarUserItem
          displayName={displayName}
          iconProps={iconProps}
          isSelf={props.organizer.isSelf}
          secondaryLabel="Organizer"
          secondaryLabelPosition="above"
        />
      </div>
    </div>
  );
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
  defaultReminders?: EventReminderOverride[];
}) {
  const conferenceUrl = createMemo(() =>
    safeConferenceUrl(props.event.conferenceUrl)
  );
  const conferenceLabel = () =>
    props.event.conferenceProvider === 'google_meet'
      ? 'Join Google Meet'
      : 'Join meeting';
  const attribution = createMemo(() => eventAttribution(props.event));
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
    <div class="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-4 gap-y-5 p-1 text-sm text-ink-muted sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-x-3 sm:gap-y-3 sm:text-xs">
      <span
        aria-hidden="true"
        class="mt-0.5 flex size-5 items-center justify-center sm:size-4"
      >
        <span
          class="size-4 rounded-sm sm:size-3"
          style={{ 'background-color': props.event.calendar.color }}
        />
      </span>
      <div class="flex min-w-0 flex-col gap-1">
        <div class="select-text text-lg font-semibold leading-snug text-ink sm:text-base">
          {props.event.title}
        </div>
        <div class="select-text text-sm text-ink-muted sm:text-xs">
          {formatEventSchedule(props.event, props.timeFormat)}
        </div>
        <Show when={recurrenceDescription()}>
          {(description) => (
            <div class="select-text text-sm text-ink-extra-muted sm:text-xs">
              {description()}
            </div>
          )}
        </Show>
      </div>

      <Show when={conferenceUrl()}>
        {(url) => (
          <div class="contents">
            <VideoCameraIcon class="size-5 self-center text-ink-extra-muted sm:size-4" />
            <Button
              fullWidth
              variant="cta"
              size="sm"
              class="h-8 rounded-lg [&_svg]:size-3.5!"
              onClick={() => openExternalUrl(url())}
            >
              {conferenceLabel()}
              <ArrowSquareOutIcon />
            </Button>
          </div>
        )}
      </Show>
      <Show when={originalTimeZone()}>
        {(timeZone) => (
          <div class="contents">
            <GlobeIcon class="mt-0.5 size-5 text-ink-extra-muted sm:size-4" />
            <span class="select-text">{timeZone()}</span>
          </div>
        )}
      </Show>

      <Show when={props.event.location?.trim()}>
        {(location) => <EventLocationItem location={location()} />}
      </Show>

      <Show when={props.event.description}>
        {(description) => (
          <div class="contents">
            <TextAlignLeftIcon class="mt-0.5 size-5 text-ink-extra-muted sm:size-4" />
            <p class="select-text leading-relaxed text-ink-muted">
              {description()}
            </p>
          </div>
        )}
      </Show>

      <EventRemindersItem
        event={props.event}
        defaultReminders={props.defaultReminders}
      />

      <CalendarSourceItem
        calendarName={attribution().calendarName}
        creator={attribution().creator}
      />
      <Show when={attribution().organizer}>
        {(eventOrganizer) => (
          <CalendarOrganizerItem organizer={eventOrganizer()} />
        )}
      </Show>
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
        class="border-edge-muted text-sm text-ink-muted sm:border-t sm:text-xs"
      >
        <Collapsible.Trigger class="group flex w-full items-center gap-4 px-4 py-4 text-left hover:bg-hover hover:text-ink sm:gap-3">
          <UsersIcon class="size-5 shrink-0 text-ink-extra-muted sm:size-4" />
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
          <div class="flex gap-4 pb-3 pl-4 pt-1.5 sm:gap-3">
            <span aria-hidden="true" class="size-5 shrink-0 sm:size-4" />
            <ScrollableAttendeeList attendees={props.attendees} />
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  );
}
