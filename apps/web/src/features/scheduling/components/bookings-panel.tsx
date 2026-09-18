import { TabsInset } from '@core/component/TabsInset';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretUp from '@phosphor/caret-up.svg';
import ClockIcon from '@phosphor/clock.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import UsersIcon from '@phosphor/users.svg';
import { Button } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import {
  type BookingTab,
  bookingTab,
  bookingTimeRange,
  filterBookings,
} from '../core/booking-list';
import type { Booking, EventType, SchedulingMember } from '../core/types';
import { SelectInput, TextInput, TimeZoneInput } from './fields';

export type BookingsPanelProps = {
  bookings: Booking[];
  events: EventType[];
  members: SchedulingMember[];
  canEdit: boolean;
  busyId: string;
  currentUserId: string;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onManage: (id: string) => void;
  onAttendance: (
    id: string,
    attendance: NonNullable<Booking['attendance']>
  ) => void;
};

function BookingStatus(props: { booking: Booking }) {
  const label = () => {
    if (props.booking.status === 'pending') return 'Unconfirmed';
    if (props.booking.status === 'failed') return 'Calendar sync failed';
    if (props.booking.status === 'processing') return 'Syncing calendar';
    if (props.booking.status === 'cancelled') return 'Cancelled';
    if (props.booking.attendance === 'guestNoShow') return 'Guest no-show';
    if (props.booking.attendance === 'hostNoShow') return 'Host no-show';
    if (props.booking.attendance === 'attended') return 'Attended';
    return new Date(props.booking.endsAt).getTime() <= Date.now()
      ? 'Ended'
      : 'Confirmed';
  };
  return (
    <span
      class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge-muted px-2 py-1 text-xs text-ink-muted"
      classList={{
        'bg-success-bg text-success border-transparent':
          props.booking.status === 'confirmed' &&
          (props.booking.attendance === 'attended' ||
            new Date(props.booking.endsAt).getTime() > Date.now()),
        'bg-warning-bg text-warning border-transparent':
          props.booking.status === 'pending' ||
          props.booking.status === 'processing',
        'bg-failure-bg text-failure border-transparent':
          props.booking.status === 'failed' ||
          props.booking.attendance === 'guestNoShow' ||
          props.booking.attendance === 'hostNoShow',
      }}
    >
      <span class="size-1.5 rounded-full bg-current" />
      {label()}
    </span>
  );
}

function BookingRow(
  props: Omit<BookingsPanelProps, 'bookings' | 'events'> & {
    booking: Booking;
    event?: EventType;
    timeZone: string;
  }
) {
  const [expanded, setExpanded] = createSignal(false);
  const [confirmCancel, setConfirmCancel] = createSignal(false);
  const isPast = () => new Date(props.booking.endsAt).getTime() <= Date.now();
  const hosts = () =>
    props.booking.hosts.map((id) => {
      const member = props.members.find((m) => m.id === id);
      return member?.name || member?.email || 'Calendar host';
    });
  const canManage = () =>
    props.canEdit &&
    (props.booking.status === 'pending' ||
      (props.booking.status === 'confirmed' && !isPast()));
  const meetingUrl = () => {
    try {
      const url = new URL(props.booking.location);
      return url.protocol === 'https:' || url.protocol === 'http:'
        ? url.href
        : undefined;
    } catch {
      return undefined;
    }
  };
  const date = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(undefined, {
      timeZone: props.timeZone,
      ...options,
    }).format(new Date(props.booking.startsAt));
  const answerLabel = (id: string) =>
    props.event?.questions.find((question) => question.id === id)?.label ??
    'Additional response';
  return (
    <article class="bg-panel px-5 py-5 @min-[720px]:px-6">
      <div class="grid min-w-0 grid-cols-[72px_1fr] gap-x-5 gap-y-4 @min-[880px]:grid-cols-[100px_1fr_auto]">
        <div class="pt-0.5">
          <p class="text-xs font-medium text-ink-muted">
            {date({ weekday: 'long' })}
          </p>
          <p class="mt-1 text-lg font-semibold tabular-nums">
            {date({ month: 'short', day: 'numeric' })}
          </p>
          <p class="mt-1 text-xs text-ink-muted">{date({ year: 'numeric' })}</p>
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="break-words font-semibold">{props.booking.title}</h3>
            <BookingStatus booking={props.booking} />
            <Show when={(props.booking.rescheduleCount ?? 0) > 0}>
              <span class="text-xs text-ink-muted">Rescheduled</span>
            </Show>
          </div>
          <p class="mt-1 text-sm">
            {props.booking.name}
            <span class="mx-1.5 text-ink-muted">·</span>
            <span class="break-all text-ink-muted">{props.booking.email}</span>
          </p>
          <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-muted">
            <span class="flex items-center gap-1.5">
              <ClockIcon class="size-3.5" />
              {bookingTimeRange(props.booking, props.timeZone)}
            </span>
            <Show when={hosts().length}>
              <span class="flex items-center gap-1.5">
                <UsersIcon class="size-3.5 shrink-0" />
                {hosts().join(', ')}
              </span>
            </Show>
          </div>
          <Show when={props.booking.location}>
            <p class="mt-2 break-words text-xs text-ink-muted">
              {props.booking.location}
            </p>
          </Show>
        </div>
        <div class="col-start-2 flex flex-wrap items-start gap-2 @min-[880px]:col-start-3">
          <Show
            when={
              props.booking.status === 'confirmed' && !isPast() && meetingUrl()
            }
          >
            <a
              href={meetingUrl()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-8 items-center rounded-md border border-edge-muted px-3 text-sm font-medium hover:bg-hover"
            >
              Join meeting ↗
            </a>
          </Show>
          <Show when={canManage() && !isPast()}>
            <Show when={props.booking.status === 'pending'}>
              <Button
                variant="strong"
                size="sm"
                disabled={!!props.busyId}
                onClick={() => props.onApprove(props.booking.id)}
              >
                Confirm
              </Button>
            </Show>
            <Button
              variant="outline"
              size="sm"
              disabled={!!props.busyId}
              onClick={() => props.onManage(props.booking.id)}
            >
              Reschedule
            </Button>
          </Show>
          <Show when={canManage()}>
            <Button
              variant="outline"
              size="sm"
              disabled={!!props.busyId}
              onClick={() => setConfirmCancel(true)}
            >
              {props.booking.status === 'pending' ? 'Decline' : 'Cancel'}
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={expanded()}
            aria-controls={`booking-details-${props.booking.id}`}
            onClick={() => setExpanded(!expanded())}
          >
            Details
            <CaretUp
              class="size-3.5 transition-transform"
              classList={{ 'rotate-180': expanded() }}
            />
          </Button>
        </div>
      </div>
      <Show when={props.busyId === props.booking.id}>
        <p role="status" class="mt-4 text-xs text-ink-muted">
          Updating booking…
        </p>
      </Show>
      <Show when={confirmCancel() && canManage()}>
        <div class="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-edge-muted bg-surface-1 p-4">
          <div class="min-w-48 flex-1 text-sm">
            <p class="font-medium">
              {props.booking.status === 'pending'
                ? 'Decline this booking request?'
                : 'Cancel this booking?'}
            </p>
            <p class="mt-1 text-ink-muted">
              This releases the reserved time and cannot be undone.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={!!props.busyId}
            onClick={() => setConfirmCancel(false)}
          >
            Keep booking
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={!!props.busyId}
            onClick={() => props.onCancel(props.booking.id)}
          >
            {props.booking.status === 'pending'
              ? 'Decline booking'
              : 'Cancel booking'}
          </Button>
        </div>
      </Show>
      <Show when={expanded()}>
        <div
          id={`booking-details-${props.booking.id}`}
          class="mt-5 grid gap-5 rounded-lg border border-edge-muted bg-surface-1 p-4 @min-[600px]:grid-cols-2"
        >
          <div class="text-sm">
            <h4 class="font-medium">Guest’s time zone</h4>
            <p class="mt-1 text-ink-muted">
              {props.booking.timeZone.replaceAll('_', ' ')}
            </p>
            <p class="mt-1 text-xs text-ink-muted">
              {new Date(props.booking.startsAt).toLocaleDateString(undefined, {
                timeZone: props.booking.timeZone,
                month: 'short',
                day: 'numeric',
              })}
              {' · '}
              {bookingTimeRange(props.booking, props.booking.timeZone)}
            </p>
          </div>
          <Show when={props.booking.status === 'confirmed' && isPast()}>
            <div class="max-w-56 text-sm">
              <h4 class="mb-2 font-medium">Attendance</h4>
              <SelectInput
                label={`Attendance for ${props.booking.name}`}
                value={props.booking.attendance ?? 'unknown'}
                options={[
                  { value: 'unknown', label: 'Not recorded' },
                  { value: 'attended', label: 'Attended' },
                  { value: 'guestNoShow', label: 'Guest no-show' },
                  { value: 'hostNoShow', label: 'Host no-show' },
                ]}
                disabled={
                  (!props.canEdit &&
                    !props.booking.hosts.includes(props.currentUserId)) ||
                  !!props.busyId
                }
                onChange={(value) => {
                  if (
                    value === 'unknown' ||
                    value === 'attended' ||
                    value === 'guestNoShow' ||
                    value === 'hostNoShow'
                  )
                    props.onAttendance(props.booking.id, value);
                }}
              />
            </div>
          </Show>
          <Show when={Object.keys(props.booking.answers).length}>
            <dl class="space-y-4 @min-[600px]:col-span-2">
              <For each={Object.entries(props.booking.answers)}>
                {([id, answer]) => (
                  <div class="text-sm">
                    <dt class="font-medium">{answerLabel(id)}</dt>
                    <dd class="mt-1 whitespace-pre-wrap break-words text-ink-muted">
                      {answer || 'No response'}
                    </dd>
                  </div>
                )}
              </For>
            </dl>
          </Show>
          <Show
            when={
              props.booking.status === 'failed' ||
              props.booking.status === 'processing'
            }
          >
            <p class="text-sm text-ink-muted @min-[600px]:col-span-2">
              {props.booking.status === 'failed'
                ? 'Calendar synchronization failed. This booking is not confirmed. Contact support before creating a replacement to avoid duplicate calendar events.'
                : 'This booking is still being synchronized with the calendar. It will appear in Upcoming once it is confirmed.'}
            </p>
          </Show>
        </div>
      </Show>
    </article>
  );
}

export function BookingsPanel(props: BookingsPanelProps) {
  const [tab, setTab] = createSignal<BookingTab>('Upcoming');
  const [search, setSearch] = createSignal('');
  const [eventId, setEventId] = createSignal('all');
  const eventFilter = () => (eventId() === 'all' ? '' : eventId());
  const [timeZone, setTimeZone] = createSignal(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const visible = () =>
    filterBookings(
      props.bookings,
      { tab: tab(), search: search(), eventId: eventFilter() },
      Date.now()
    );
  const tabs = (): BookingTab[] => [
    'Upcoming',
    'Unconfirmed',
    'Past',
    'Cancelled',
    ...(props.bookings.some((booking) =>
      ['failed', 'processing'].includes(booking.status)
    ) || tab() === 'Needs attention'
      ? (['Needs attention'] as const)
      : []),
  ];
  const eventOptions = () => [
    { value: 'all', label: 'All event types' },
    ...Array.from(
      new Map([
        ...props.bookings.map((b) => [b.eventTypeId, b.title] as const),
        ...props.events.map((e) => [e.id, e.title] as const),
      ])
    ).map(([value, label]) => ({ value, label })),
  ];
  return (
    <div class="flex min-w-0 flex-col gap-5">
      <div class="overflow-x-auto pb-1">
        <TabsInset
          aria-label="Booking status"
          class="h-auto w-fit"
          depth={1}
          labelClass="h-9 gap-2 px-3 text-sm whitespace-nowrap"
          list={tabs().map((value) => ({
            value,
            label: (
              <>
                {value}
                <span class="rounded bg-ink/5 px-1.5 text-xs tabular-nums">
                  {
                    props.bookings.filter(
                      (booking) => bookingTab(booking, Date.now()) === value
                    ).length
                  }
                </span>
              </>
            ),
          }))}
          value={tab()}
          onChange={(value) => {
            const selected = tabs().find((item) => item === value);
            if (selected) setTab(selected);
          }}
        />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="relative min-w-48 flex-1">
          <MagnifyingGlass class="pointer-events-none absolute top-3 left-3 size-4 text-ink-muted" />
          <TextInput
            aria-label="Search bookings"
            placeholder="Search by name, email, or event…"
            class="pl-9"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
        <div class="w-48">
          <SelectInput
            label="Filter bookings by event type"
            options={eventOptions()}
            value={eventId()}
            onChange={setEventId}
          />
        </div>
        <div class="w-56">
          <TimeZoneInput value={timeZone()} onChange={setTimeZone} />
        </div>
      </div>
      <Show when={tab() === 'Needs attention'}>
        <p class="rounded-lg border border-edge-muted bg-surface-1 p-4 text-sm text-ink-muted">
          These bookings are awaiting calendar synchronization or need help.
          They are kept separate from confirmed meetings.
        </p>
      </Show>
      <div class="overflow-hidden rounded-xl border border-edge-muted divide-y divide-edge-muted">
        <For
          each={visible()}
          fallback={
            <div class="flex flex-col items-center gap-3 bg-panel px-6 py-16 text-center">
              <div class="rounded-xl border border-edge-muted bg-surface-1 p-3">
                <CalendarIcon class="size-6 text-ink-muted" />
              </div>
              <h3 class="font-semibold">
                {search() || eventFilter()
                  ? 'No matching bookings'
                  : tab() === 'Needs attention'
                    ? 'No bookings need attention'
                    : `No ${tab().toLowerCase()} bookings`}
              </h3>
              <p class="max-w-sm text-sm text-ink-muted">
                {search() || eventFilter()
                  ? 'Try another name, email, or event type.'
                  : tab() === 'Upcoming'
                    ? 'When someone books your event, you’ll see their details here.'
                    : tab() === 'Unconfirmed'
                      ? 'Booking requests that need your approval will appear here.'
                      : tab() === 'Past'
                        ? 'Your previous meetings will appear here after they end.'
                        : tab() === 'Cancelled'
                          ? 'Cancelled and declined bookings will appear here.'
                          : 'Your bookings are up to date.'}
              </p>
              <Show when={search() || eventFilter()}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setEventId('');
                  }}
                >
                  Clear filters
                </Button>
              </Show>
            </div>
          }
        >
          {(booking) => (
            <BookingRow
              {...props}
              booking={booking}
              event={props.events.find((e) => e.id === booking.eventTypeId)}
              timeZone={timeZone()}
            />
          )}
        </For>
      </div>
      <p class="text-xs text-ink-muted">
        {visible().length} {visible().length === 1 ? 'booking' : 'bookings'}
        {' · '}Times shown in {timeZone().replaceAll('_', ' ')}
      </p>
    </div>
  );
}
