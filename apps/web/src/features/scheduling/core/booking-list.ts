import type { Booking } from './types';

export type BookingTab =
  | 'Upcoming'
  | 'Unconfirmed'
  | 'Past'
  | 'Cancelled'
  | 'Needs attention';

export function bookingTab(booking: Booking, now: number): BookingTab {
  if (booking.status === 'pending') return 'Unconfirmed';
  if (booking.status === 'cancelled') return 'Cancelled';
  if (booking.status === 'failed' || booking.status === 'processing')
    return 'Needs attention';
  return new Date(booking.endsAt).getTime() <= now ? 'Past' : 'Upcoming';
}

export function filterBookings(
  bookings: Booking[],
  filters: { tab: BookingTab; search: string; eventId: string },
  now: number
): Booking[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return bookings
    .filter(
      (booking) =>
        bookingTab(booking, now) === filters.tab &&
        (!filters.eventId || booking.eventTypeId === filters.eventId) &&
        (!search ||
          [booking.title, booking.name, booking.email].some((value) =>
            value.toLocaleLowerCase().includes(search)
          ))
    )
    .sort((a, b) => {
      const difference =
        new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
      return filters.tab === 'Past' || filters.tab === 'Cancelled'
        ? -difference
        : difference;
    });
}

function shareTimeZone(start: Date, end: Date, timeZone: string): boolean {
  const offset = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const name = (date: Date) =>
    offset.formatToParts(date).find((part) => part.type === 'timeZoneName')
      ?.value;
  return name(start) === name(end);
}

/** Keep clock values and zone labels separate so cards can wrap between endpoints. */
export function bookingTimeRangeDisplay(booking: Booking, timeZone: string) {
  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  const clock = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const zone = new Intl.DateTimeFormat(undefined, {
    timeZone,
    timeZoneName: 'short',
  });
  const date = new Intl.DateTimeFormat(undefined, {
    timeZone,
    dateStyle: 'medium',
  });
  const endpoint = (value: Date) => ({
    time: clock.format(value),
    timeZone: zone
      .formatToParts(value)
      .find((part) => part.type === 'timeZoneName')?.value,
  });
  return {
    start: endpoint(start),
    end: endpoint(end),
    sharedTimeZone: shareTimeZone(start, end, timeZone),
    endDate:
      date.format(start) !== date.format(end) ? date.format(end) : undefined,
  };
}

export function bookingTimeRange(booking: Booking, timeZone: string): string {
  const start = new Date(booking.startsAt);
  const end = new Date(booking.endsAt);
  const day = new Intl.DateTimeFormat(undefined, { timeZone });
  const differentDays = day.format(start) !== day.format(end);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const sharedTimeZone = shareTimeZone(start, end, timeZone);
  // Intl range formatting can collapse distinct instants across a DST change.
  if (!differentDays && sharedTimeZone) return time.formatRange(start, end);
  const endTime = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(differentDays ? { month: 'short', day: 'numeric' } : {}),
  });
  const startTime = sharedTimeZone
    ? new Intl.DateTimeFormat(undefined, {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
      })
    : time;
  return `${startTime.format(start)} – ${endTime.format(end)}`;
}

export type BookingDateGroup = {
  date: string;
  label: string;
  bookings: Booking[];
};

/** Preserve the filtered order while grouping by the displayed start date. */
export function groupBookingsByDate(
  bookings: Booking[],
  timeZone: string
): BookingDateGroup[] {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const label = new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const groups = new Map<string, BookingDateGroup>();
  for (const booking of bookings) {
    const start = new Date(booking.startsAt);
    const key = date.format(start);
    const group = groups.get(key);
    if (group) group.bookings.push(booking);
    else
      groups.set(key, {
        date: key,
        label: label.format(start),
        bookings: [booking],
      });
  }
  return [...groups.values()];
}

export function bookingIsPast(booking: Booking, now: number): boolean {
  return new Date(booking.endsAt).getTime() <= now;
}

export function canManageBooking(
  booking: Booking,
  canManageBookings: boolean,
  currentUserId: string,
  now: number
): boolean {
  return (
    (canManageBookings && booking.status === 'pending') ||
    ((canManageBookings || booking.hosts.includes(currentUserId)) &&
      booking.status === 'confirmed' &&
      !bookingIsPast(booking, now))
  );
}

export function bookingMeetingUrl(location: string): string | undefined {
  try {
    const url = new URL(location);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
