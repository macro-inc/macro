import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isIOS } from './utilMobileSignup';

const analytics = vi.hoisted(() => ({
  order: [] as string[],
  identifyMobileCapture: vi.fn((email: string) => {
    analytics.order.push(`identify:${email}`);
  }),
  track: vi.fn((event: string, data?: Record<string, unknown>) => {
    analytics.order.push(`${event}:${String(data?.button_name)}`);
  }),
}));

vi.mock('./utilAnalytic', () => ({
  analytics: {
    identifyMobileCapture: analytics.identifyMobileCapture,
    track: analytics.track,
  },
}));

describe('isIOS', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, true],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, false],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5, false],
  ])('%s with %i touch points → %s', (userAgent, maxTouchPoints, expected) => {
    expect(isIOS(userAgent, maxTouchPoints)).toBe(expected);
  });
});

describe('recordMobileSignupSubmitted', () => {
  beforeEach(() => {
    analytics.order.length = 0;
    analytics.identifyMobileCapture.mockClear();
    analytics.track.mockClear();
  });

  it('identifies the normalized email before mobile_signup_submitted', async () => {
    const { recordMobileSignupSubmitted } = await import('./utilMobileSignup');
    expect(
      recordMobileSignupSubmitted(' Person@Example.com ', {
        buttonName: 'mobile_signup_page',
        pageLocation: 'https://macro.com/mobile-signup',
      })
    ).toBe('person@example.com');
    expect(analytics.order).toEqual([
      'identify:person@example.com',
      'mobile_signup_submitted:mobile_signup_page',
    ]);
    expect(analytics.track).toHaveBeenCalledWith('mobile_signup_submitted', {
      page_location: 'https://macro.com/mobile-signup',
      button_name: 'mobile_signup_page',
    });
  });

  it('does not identify or track an address the form would reject', async () => {
    const { recordMobileSignupSubmitted } = await import('./utilMobileSignup');
    expect(
      recordMobileSignupSubmitted('not-an-email', {
        buttonName: 'mobile_signup_page',
        pageLocation: 'https://macro.com/mobile-signup',
      })
    ).toBeNull();
    expect(analytics.order).toEqual([]);
  });
});
