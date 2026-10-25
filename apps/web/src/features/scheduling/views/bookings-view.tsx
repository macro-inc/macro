import { SearchBar } from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { type JSX, Show } from 'solid-js';
import { BookingDetailsDialog } from '../components/booking-details-dialog';
import { BookingStatusTabs, BookingsPanel } from '../components/bookings-panel';
import { SelectInput } from '../components/fields';
import { SchedulingFilterSection } from '../components/scheduling-filter-section';
import { SchedulingFilters } from '../components/scheduling-filters';
import { TimezoneSelect } from '../components/TimezoneSelect';
import type { Booking, EventType, SchedulingMember } from '../core/types';
import { createBookingsView } from '../primitives/create-bookings-view';

const TIME_ZONES = Intl.supportedValuesOf('timeZone').map((value) => ({
  value,
  label: value.replaceAll('_', ' '),
}));

export function BookingsView(props: {
  headerTitle?: JSX.Element;
  registerSearchFocus?: (focus: () => void) => void;
  bookings: Booking[];
  events: EventType[];
  members: SchedulingMember[];
  canManageBookings: boolean;
  busyId: string;
  currentUserId: string;
  search?: string;
  onSearchChange?: (value: string) => void;
  dateRange?: JSX.Element;
  loading?: boolean;
  error?: string;
  onApprove: (id: string) => void;
  onCancel: (id: string) => void;
  onManage: (id: string) => void;
  onAttendance: (id: string, attendance: Booking['attendance']) => void;
}) {
  const state = createBookingsView({
    bookings: () => props.bookings,
    events: () => props.events,
    search: () => props.search,
    onSearchChange: (value) => props.onSearchChange?.(value),
  });
  let panel: HTMLDivElement | undefined;
  const filters = () => (
    <SchedulingFilters
      title="Booking filters"
      activeCount={state.eventId() === 'all' ? 0 : 1}
      onClear={state.clearFilters}
      mobileChildren={
        <>
          <SchedulingFilterSection
            value="booking-links"
            label="Booking links"
            selected={state.eventId()}
            options={state.eventOptions()}
            onChange={state.setEventId}
          />
          <SchedulingFilterSection
            value="time-zone"
            label="Time zone"
            selected={state.timeZone()}
            options={
              TIME_ZONES.some((option) => option.value === state.timeZone())
                ? TIME_ZONES
                : [
                    {
                      value: state.timeZone(),
                      label: state.timeZone().replaceAll('_', ' '),
                    },
                    ...TIME_ZONES,
                  ]
            }
            onChange={state.setTimeZone}
            activeCount={0}
          />
          <MobileFilterDrawer.Section
            value="date-range"
            label="Date range"
            activeCount={0}
          >
            {props.dateRange}
          </MobileFilterDrawer.Section>
        </>
      }
    >
      <div class="min-w-0">
        <SelectInput
          label="Filter bookings by event type"
          value={state.eventId()}
          options={state.eventOptions()}
          onChange={state.setEventId}
          class="w-full text-sm touch:h-9"
        />
      </div>
      <TimezoneSelect
        value={state.timeZone()}
        onChange={state.setTimeZone}
        options={TIME_ZONES}
        class="w-full"
        portalScope="local"
      />
      {props.dateRange}
    </SchedulingFilters>
  );
  return (
    <div
      ref={panel}
      tabindex="-1"
      class="min-w-0 outline-none"
      aria-label="Bookings list"
    >
      <Show
        when={props.headerTitle}
        fallback={
          <div class="mb-5 flex min-w-0 items-center gap-2">
            <SearchBar
              label="Search bookings"
              placeholder="Search bookings…"
              value={state.search()}
              onValueChange={state.setSearch}
              class="max-w-md min-w-0 flex-1"
            />
            {filters()}
          </div>
        }
      >
        <ListHeader
          title={
            <div class="flex min-w-0 items-center gap-3">
              {props.headerTitle}
              <BookingStatusTabs
                tabs={state.tabs()}
                tab={state.tab()}
                onTab={state.setTab}
              />
            </div>
          }
        >
          <HeaderActionGroup label="Booking filters">
            {filters()}
          </HeaderActionGroup>
          <ListHeaderSearch
            label="Search bookings"
            value={state.search()}
            onValueChange={state.setSearch}
            registerFocus={(focus) => props.registerSearchFocus?.(focus)}
          />
        </ListHeader>
      </Show>
      <div class={props.headerTitle ? 'px-4 pt-3' : undefined}>
        <BookingsPanel
          hideTabs={!!props.headerTitle}
          members={props.members}
          groups={state.groups()}
          tabs={state.tabs()}
          tab={state.tab()}
          search={state.search()}
          eventId={state.eventId()}
          timeZone={state.timeZone()}
          count={state.visible().length}
          loading={props.loading}
          error={props.error}
          canManageBookings={props.canManageBookings}
          currentUserId={props.currentUserId}
          busyId={props.busyId}
          onTab={state.setTab}
          onClear={state.clearFilters}
          onView={state.openDetails}
          onApprove={props.onApprove}
          onManage={props.onManage}
        />
      </div>
      <Show when={state.selection()} keyed>
        {(selection) => (
          <Show when={state.selected()}>
            {(booking) => (
              <BookingDetailsDialog
                booking={booking()}
                event={props.events.find(
                  (event) => event.id === booking().eventTypeId
                )}
                members={props.members}
                timeZone={state.timeZone()}
                currentUserId={props.currentUserId}
                canManageBookings={props.canManageBookings}
                busyId={props.busyId}
                error={props.error}
                confirmCancel={selection.confirmCancel}
                onClose={state.closeDetails}
                onRestoreFocus={() => {
                  if (!panel?.isConnected) return;
                  const row = panel?.querySelector<HTMLButtonElement>(
                    `[data-booking-opener="${CSS.escape(selection.id)}"]`
                  );
                  const target =
                    row ??
                    (selection.opener?.isConnected ? selection.opener : panel);
                  if (target?.isConnected)
                    target.focus({ preventScroll: true });
                }}
                onApprove={props.onApprove}
                onCancel={props.onCancel}
                onManage={props.onManage}
                onAttendance={props.onAttendance}
              />
            )}
          </Show>
        )}
      </Show>
    </div>
  );
}
