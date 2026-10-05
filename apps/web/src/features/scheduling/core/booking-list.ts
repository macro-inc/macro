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
  const endTime = new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    ...(differentDays ? { month: 'short', day: 'numeric' } : {}),
  });
  return `${time.format(start)} – ${endTime.format(end)}`;
}
