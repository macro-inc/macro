import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false, loading: false }),
}));
vi.mock('@solidjs/router', () => ({
  useLocation: () => ({ hash: '#private-receipt-token' }),
  useNavigate: () => vi.fn(),
}));
vi.mock('./queries/public', () => ({
  createBookingReceiptSource: vi.fn(() => ({
    receipt: { isSuccess: false, isError: true },
    cancel: vi.fn(),
    replacementSlots: vi.fn(),
    reschedule: vi.fn(),
  })),
  createPublicBookingSource: vi.fn(),
  usePublicProfileQuery: vi.fn(),
}));
vi.mock('./views/booking-receipt-view', () => ({
  BookingReceiptView: () => <p>Private booking receipt</p>,
}));
vi.mock('./views/public-booking-view', () => ({
  PublicBookingView: () => <p>Choose an event</p>,
}));

import { BookingReceiptPage } from './public-booking';
import { createBookingReceiptSource } from './queries/public';

describe('booking receipt route', () => {
  it('lets a form respondent use their private receipt outside the Calendar rollout', () => {
    render(() => <BookingReceiptPage id="booking-from-a-form" />);

    expect(screen.getByText('Private booking receipt')).toBeTruthy();
    const [bookingId, token] = vi.mocked(createBookingReceiptSource).mock
      .calls[0];
    expect(bookingId()).toBe('booking-from-a-form');
    expect(token()).toBe('private-receipt-token');
  });
});
