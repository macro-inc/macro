import { PosthogProvider } from '@app/lib/analytics/posthog';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { PostHog } from 'posthog-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({
  onFeatureFlags: vi.fn<PostHog['onFeatureFlags']>(),
  getFeatureFlagResult: vi.fn<PostHog['getFeatureFlagResult']>(),
  featureFlags: { getFlags: vi.fn<() => string[]>() },
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ posthog }),
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
  usePublicProfileQuery: vi.fn(() => ({
    isSuccess: true,
    isError: false,
    data: { id: 'team', name: 'Macro', eventTypes: [] },
  })),
}));
vi.mock('./views/booking-receipt-view', () => ({
  BookingReceiptView: () => <p>Private booking receipt</p>,
}));
vi.mock('./views/public-booking-view', () => ({
  PublicBookingView: (props: {
    onReceipt: (receipt: { booking: { id: string }; token: string }) => void;
  }) => (
    <button
      onClick={() => props.onReceipt({ booking: { id: 'b1' }, token: 't1' })}
    >
      Choose an event
    </button>
  ),
}));

import { BookingReceiptPage, PublicBookingPage } from './public-booking';
import {
  createBookingReceiptSource,
  usePublicProfileQuery,
} from './queries/public';

const SCHEDULING_FLAG = 'enable-calendar-scheduling';

/** Mounts the page and returns PostHog's pending answer to the flag request. */
function openBookingLink() {
  render(() => (
    <PosthogProvider>
      <PublicBookingPage profile="team" />
    </PosthogProvider>
  ));
  const answer = posthog.onFeatureFlags.mock.calls[0]?.[0];
  if (!answer) throw new Error('PostHog provider is not mounted');
  return answer;
}

beforeEach(() => {
  vi.clearAllMocks();
  posthog.getFeatureFlagResult.mockReset();
  posthog.featureFlags.getFlags.mockReturnValue([]);
  posthog.onFeatureFlags.mockReturnValue(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('public booking route', () => {
  it('lets a guest book when the flag request gets no answer', async () => {
    const answer = openBookingLink();
    expect(screen.getByText('Loading…')).toBeTruthy();

    answer([], {}, { errorsLoading: true });

    expect(await screen.findByText('Choose an event')).toBeTruthy();
  });

  it('opens once PostHog reports the rollout on', async () => {
    posthog.getFeatureFlagResult.mockReturnValue({
      key: SCHEDULING_FLAG,
      enabled: true,
      variant: undefined,
      payload: undefined,
    });
    const answer = openBookingLink();

    answer([SCHEDULING_FLAG], { [SCHEDULING_FLAG]: true });

    expect(await screen.findByText('Choose an event')).toBeTruthy();
  });

  it('stays unavailable, without loading the profile, while the rollout is off', async () => {
    posthog.getFeatureFlagResult.mockReturnValue({
      key: SCHEDULING_FLAG,
      enabled: false,
      variant: undefined,
      payload: undefined,
    });
    const answer = openBookingLink();

    answer([], { [SCHEDULING_FLAG]: false });

    expect(
      await screen.findByText('This booking page is unavailable.')
    ).toBeTruthy();
    expect(usePublicProfileQuery).not.toHaveBeenCalled();
  });
});

describe('public booking route in the website dialog', () => {
  it('tells the website when a guest books', async () => {
    const website = { postMessage: vi.fn() };
    vi.stubGlobal('parent', website);
    posthog.getFeatureFlagResult.mockReturnValue({
      key: SCHEDULING_FLAG,
      enabled: true,
      variant: undefined,
      payload: undefined,
    });
    const answer = openBookingLink();
    answer([SCHEDULING_FLAG], { [SCHEDULING_FLAG]: true });

    fireEvent.click(await screen.findByText('Choose an event'));

    expect(website.postMessage).toHaveBeenCalledWith(
      { type: 'macro:booking-made' },
      window.location.origin
    );
  });
});

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
