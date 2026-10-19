import { type Accessor, createMemo, createSignal } from 'solid-js';
import {
  type BookingTab,
  bookingTab,
  filterBookings,
  groupBookingsByDate,
} from '../core/booking-list';
import type { Booking, EventType } from '../core/types';

export function createBookingsView(options: {
  bookings: Accessor<Booking[]>;
  events: Accessor<EventType[]>;
  search: Accessor<string | undefined>;
  onSearchChange?: (value: string) => void;
}) {
  const [tab, setTab] = createSignal<BookingTab>('Upcoming');
  const [localSearch, setLocalSearch] = createSignal('');
  const [eventId, setEventId] = createSignal('all');
  const [timeZone, setTimeZone] = createSignal(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [selection, setSelection] = createSignal<{
    id: string;
    opener?: HTMLElement;
    confirmCancel: boolean;
  }>();
  const search = () => options.search() ?? localSearch();
  const setSearch = (value: string) => {
    if (options.search() === undefined) setLocalSearch(value);
    else options.onSearchChange?.(value);
  };
  const visible = createMemo(() =>
    filterBookings(
      options.bookings(),
      {
        tab: tab(),
        search: search(),
        eventId: eventId() === 'all' ? '' : eventId(),
      },
      Date.now()
    )
  );
  const groups = createMemo(() => groupBookingsByDate(visible(), timeZone()));
  const tabs = createMemo(() => {
    const counts = new Map<BookingTab, number>();
    for (const booking of options.bookings()) {
      const key = bookingTab(booking, Date.now());
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const values: BookingTab[] = [
      'Upcoming',
      'Unconfirmed',
      'Past',
      'Cancelled',
    ];
    if (counts.has('Needs attention') || tab() === 'Needs attention')
      values.push('Needs attention');
    return values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
  });
  const eventOptions = createMemo(() => [
    { value: 'all', label: 'All booking links' },
    ...Array.from(
      new Map([
        ...options
          .bookings()
          .map((booking) => [booking.eventTypeId, booking.title] as const),
        ...options.events().map((event) => [event.id, event.title] as const),
      ])
    ).map(([value, label]) => ({ value, label })),
  ]);
  const selected = () =>
    options.bookings().find((booking) => booking.id === selection()?.id);
  const openDetails = (
    booking: Booking,
    opener?: HTMLElement,
    confirmCancel = false
  ) => setSelection({ id: booking.id, opener, confirmCancel });
  const closeDetails = () => setSelection(undefined);
  const clearFilters = () => {
    setSearch('');
    setEventId('all');
  };
  return {
    tab,
    setTab,
    search,
    setSearch,
    eventId,
    setEventId,
    timeZone,
    setTimeZone,
    visible,
    groups,
    tabs,
    eventOptions,
    selected,
    selection,
    openDetails,
    closeDetails,
    clearFilters,
  };
}
