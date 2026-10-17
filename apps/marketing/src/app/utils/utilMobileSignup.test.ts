import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('recordMobileSignupSubmitted', () => {
  beforeEach(() => {
    analytics.order.length = 0;
    analytics.identifyMobileCapture.mockClear();
    analytics.track.mockClear();
  });

  it('identifies the normalized email before mobile_signup_submitted', async () => {
    const { recordMobileSignupSubmitted } = await import('./utilMobileSignup');
    expect(
      recordMobileSignupSubmitted(' Dartagnan@CtrlStrategies.com ', {
        buttonName: 'mobile_signup_page',
        pageLocation: 'https://macro.com/mobile-signup',
      })
    ).toBe('dartagnan@ctrlstrategies.com');
    expect(analytics.order).toEqual([
      'identify:dartagnan@ctrlstrategies.com',
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
