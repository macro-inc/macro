import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { Booking, BookingReceipt } from '../core/types';
import { BookingReceiptView } from './booking-receipt-view';

afterEach(cleanup);

function receipt(overrides: Partial<Booking> = {}): BookingReceipt {
  return {
    token: 'token',
    scheduleTimeZone: 'UTC',
    booking: {
      id: 'meeting',
      eventTypeId: 'intro',
      title: 'Introduction',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      startsAt: '2026-09-18T17:00:00Z',
      endsAt: '2026-09-18T17:30:00Z',
      timeZone: 'UTC',
      hosts: ['host'],
      status: 'failed',
      abandonedAt: '2026-09-18T15:00:00Z',
      location: '',
      answers: {},
      attendance: 'unknown',
      rescheduleCount: 0,
      rescheduledAt: null,
      ...overrides,
    },
  };
}

function renderReceipt(afterCancel: BookingReceipt, returned?: Booking) {
  const [current, setCurrent] = createSignal(receipt());
  const cancel = vi.fn(async () => {
    setCurrent(afterCancel);
    return returned ?? afterCancel.booking;
  });
  render(() => (
    <BookingReceiptView
      receipt={current()}
      unavailable={false}
      cancel={cancel}
      loadSlots={async () => []}
      reschedule={async () => {}}
    />
  ));
  return cancel;
}

async function confirmCancel() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
  await user.click(
    screen.getByRole('button', { name: 'Confirm cancellation' })
  );
}

it('offers only Cancel on a booking Macro stopped retrying', async () => {
  const cancel = renderReceipt(receipt({ status: 'cancelled' }));
  expect(
    screen.getByRole('heading', { name: 'Not added to your host’s calendar' })
  ).toBeTruthy();
  expect(screen.queryByText(/retrying/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Reschedule' })).toBeNull();
  expect(
    screen.getByText('Keep this private link to cancel your booking.')
  ).toBeTruthy();
  await confirmCancel();
  expect(cancel).toHaveBeenCalledOnce();
  expect(
    screen.getByRole('heading', { name: 'Booking cancelled' })
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('says so when the host’s calendar refuses the cancellation', async () => {
  renderReceipt(receipt());
  await confirmCancel();
  expect(screen.getByRole('alert').textContent).toBe(
    'The cancellation didn’t reach your host’s calendar. Please try again later.'
  );
});

it('drops the refusal once the receipt shows the booking cancelled', async () => {
  renderReceipt(receipt({ status: 'cancelled' }), receipt().booking);
  await confirmCancel();
  expect(
    screen.getByRole('heading', { name: 'Booking cancelled' })
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
