import {
  deserializeToolCall,
  deserializeToolResponse,
} from '@service-cognition/generated/tools/tool';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { listBookingsHandler } from './BookingManagement';

afterEach(cleanup);

it('renders and expands an empty booking result instead of hiding it', () => {
  const view = render(() => (
    <listBookingsHandler.render
      tool={{
        id: 'list',
        name: 'ListBookings',
        data: { from: '2026-10-01T00:00:00Z', to: '2026-11-01T00:00:00Z' },
      }}
      response={{ id: 'list', name: 'ListBookings', data: { bookings: [] } }}
      chat_id="chat"
      message_id="message"
      part_index={0}
      isComplete
      renderContext={{ isStreaming: false, followedBy: () => false }}
    />
  ));
  expect(view.getByText('0 bookings')).toBeTruthy();
  fireEvent.click(view.getByRole('button'));
  expect(view.getByText(/"bookings": \[\]/)).toBeTruthy();
});

it('parses reporting filters and discriminated booking changes', () => {
  expect(
    deserializeToolCall({
      id: 'report',
      name: 'GetBookingInsights',
      json: {
        query: {
          from: '2026-10-01',
          to: '2026-10-31',
          timeZone: 'America/New_York',
        },
      },
    }).isOk()
  ).toBe(true);
  expect(
    deserializeToolCall({
      id: 'change',
      name: 'ChangeBooking',
      json: {
        bookingId: crypto.randomUUID(),
        change: { action: 'attendance', attendance: 'guestNoShow' },
      },
    }).isOk()
  ).toBe(true);
  expect(
    deserializeToolResponse({
      id: 'slots',
      name: 'GetBookingRescheduleSlots',
      json: { slots: [] },
    }).isOk()
  ).toBe(true);
});
