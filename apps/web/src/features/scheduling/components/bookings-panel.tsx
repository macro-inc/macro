import Calendar from '@phosphor/calendar-blank.svg';
import { Button, Tabs } from '@ui';
import { For, Show } from 'solid-js';
import type { BookingDateGroup, BookingTab } from '../core/booking-list';
import type { Booking, SchedulingMember } from '../core/types';
import { BookingCard } from './booking-card';

export function BookingsPanel(props: {
  groups: BookingDateGroup[];
  tabs: { value: BookingTab; count: number }[];
  tab: BookingTab;
  search: string;
  eventId: string;
  timeZone: string;
  count: number;
  loading?: boolean;
  error?: string;
  canManageBookings: boolean;
  currentUserId: string;
  members: SchedulingMember[];
  busyId: string;
  onTab: (tab: BookingTab) => void;
  onClear: () => void;
  onView: (
    booking: Booking,
    opener?: HTMLElement,
    confirmCancel?: boolean
  ) => void;
  onApprove: (id: string) => void;
  onManage: (id: string) => void;
}) {
  const filtered = () => !!props.search.trim() || props.eventId !== 'all';
  return (
    <div class="@container/bookings flex min-w-0 flex-col gap-5">
      <div class="flex min-w-0 items-center gap-3">
        <div class="max-w-full overflow-x-auto pb-1">
          <Tabs
            aria-label="Booking status"
            class="w-fit"
            labelClass="gap-2 whitespace-nowrap px-3 text-sm"
            list={props.tabs.map((tab) => ({
              value: tab.value,
              label: () => (
                <>
                  {tab.value}
                  <span class="text-xs text-ink-muted tabular-nums">
                    {tab.count}
                  </span>
                </>
              ),
            }))}
            value={props.tab}
            onChange={(value) => {
              const tab = props.tabs.find((tab) => tab.value === value);
              if (tab) props.onTab(tab.value);
            }}
          />
        </div>
      </div>
      <Show when={props.tab === 'Needs attention'}>
        <p class="text-sm text-ink-muted">
          These bookings are awaiting calendar synchronization or need help.
          They are not confirmed meetings.
        </p>
      </Show>
      <For
        each={props.groups.map((group) => group.date)}
        fallback={
          <Show when={!props.loading && !props.error}>
            <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
              <Calendar aria-hidden="true" class="size-7 text-ink-muted" />
              <h2 class="text-sm font-medium">
                {filtered()
                  ? 'No matching bookings'
                  : props.tab === 'Needs attention'
                    ? 'No bookings need attention'
                    : `No ${props.tab.toLowerCase()} bookings`}
              </h2>
              <p class="max-w-sm text-sm text-ink-muted">
                {filtered()
                  ? 'Try another name, email, or booking link.'
                  : props.tab === 'Upcoming'
                    ? 'Meetings booked through your links will appear here.'
                    : props.tab === 'Unconfirmed'
                      ? 'Booking requests that need approval will appear here.'
                      : props.tab === 'Past'
                        ? 'Your previous meetings will appear here after they end.'
                        : props.tab === 'Cancelled'
                          ? 'Cancelled and declined bookings will appear here.'
                          : 'Your bookings are up to date.'}
              </p>
              <Show when={filtered()}>
                <Button variant="ghost" size="md" onClick={props.onClear}>
                  Clear filters
                </Button>
              </Show>
            </div>
          </Show>
        }
      >
        {(date) => {
          // Stable date keys retain unrelated cards when a booking changes.
          const group = () => props.groups.find((group) => group.date === date);
          return (
            <section aria-label={group()?.label} class="min-w-0">
              <h2 class="sr-only">{group()?.label}</h2>
              <div class="flex min-w-0 flex-col gap-3">
                <For each={group()?.bookings ?? []}>
                  {(booking) => (
                    <BookingCard
                      booking={booking}
                      timeZone={props.timeZone}
                      canManageBookings={props.canManageBookings}
                      currentUserId={props.currentUserId}
                      busyId={props.busyId}
                      hostNames={booking.hosts
                        .map((id) => {
                          const member = props.members.find(
                            (member) => member.id === id
                          );
                          return (
                            member?.name || member?.email || 'Calendar host'
                          );
                        })
                        .join(', ')}
                      onView={props.onView}
                      onApprove={props.onApprove}
                      onManage={props.onManage}
                    />
                  )}
                </For>
              </div>
            </section>
          );
        }}
      </For>
      <Show when={!props.loading && !props.error}>
        <p class="px-2 text-xs text-ink-muted">
          {props.count} {props.count === 1 ? 'booking' : 'bookings'} · Times
          shown in {props.timeZone.replaceAll('_', ' ')}
        </p>
      </Show>
    </div>
  );
}
