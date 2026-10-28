import Calendar from '@icon/system/regular/calendar.svg';
import { createSignal } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type BookingManagementTool =
  | 'ReadBookingSettings'
  | 'UpdateBookingSettings'
  | 'ListBookings'
  | 'GetBookingInsights'
  | 'GetBookingRescheduleSlots'
  | 'ChangeBooking';

function bookingManagementHandler(name: BookingManagementTool, label: string) {
  return createToolRenderer({
    name,
    render: (ctx) => {
      const [expanded, setExpanded] = createSignal(false);
      const result = () => ctx.response?.data;
      const status = () => {
        const data = result();
        if (data === undefined) return undefined;
        if ('bookings' in data) return `${data.bookings.length} bookings`;
        if ('slots' in data) return `${data.slots.length} times`;
        if ('current' in data) return `${data.current.counts.total} events`;
        if ('status' in data) return data.status;
        return name === 'UpdateBookingSettings' ? 'Saved' : 'Loaded';
      };
      return (
        <BaseTool
          icon={Calendar}
          type="call"
          renderContext={ctx.renderContext}
          response={
            expanded() && result() !== undefined ? (
              <pre class="max-h-96 overflow-auto whitespace-pre-wrap break-words p-3 text-xs">
                {JSON.stringify(result(), null, 2)}
              </pre>
            ) : undefined
          }
        >
          <span class="min-w-0 flex-1">{label}</span>
          <Tool.ResultToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
            showToggle={result() !== undefined}
            status={status()}
          />
        </BaseTool>
      );
    },
  });
}

export const readBookingSettingsHandler = bookingManagementHandler(
  'ReadBookingSettings',
  'Read booking settings'
);
export const updateBookingSettingsHandler = bookingManagementHandler(
  'UpdateBookingSettings',
  'Update booking settings'
);
export const listBookingsHandler = bookingManagementHandler(
  'ListBookings',
  'List bookings'
);
export const getBookingInsightsHandler = bookingManagementHandler(
  'GetBookingInsights',
  'Booking insights'
);
export const getBookingRescheduleSlotsHandler = bookingManagementHandler(
  'GetBookingRescheduleSlots',
  'Find replacement times'
);
export const changeBookingHandler = bookingManagementHandler(
  'ChangeBooking',
  'Change booking'
);
