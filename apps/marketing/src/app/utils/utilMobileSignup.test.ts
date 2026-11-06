import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mobileStorePlatform } from './utilMobileSignup';

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

describe('mobileStorePlatform', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, undefined],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5, 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, undefined],
  ])('%s with %i touch points → %s', (userAgent, maxTouchPoints, expected) => {
    expect(mobileStorePlatform(userAgent, maxTouchPoints)).toBe(expected);
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

describe('shareTeamInvite', () => {
  const url = 'https://macro.com/?utm_source=mobile_invite';

  it('opens the share sheet when the browser has one', async () => {
    const { shareTeamInvite } = await import('./utilMobileSignup');
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    expect(
      await shareTeamInvite(url, {
        share,
        clipboard: { writeText },
      })
    ).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('reports a closed share sheet as cancelled without copying', async () => {
    const { shareTeamInvite } = await import('./utilMobileSignup');
    const writeText = vi.fn(async () => {});
    expect(
      await shareTeamInvite(url, {
        share: vi.fn(async () => {
          throw new DOMException('closed', 'AbortError');
        }),
        clipboard: { writeText },
      })
    ).toBe('cancelled');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('copies the link in browsers without a share sheet', async () => {
    const { shareTeamInvite } = await import('./utilMobileSignup');
    const writeText = vi.fn(async () => {});
    expect(
      await shareTeamInvite(url, {
        clipboard: { writeText },
      })
    ).toBe('copied');
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(url));
  });

  it('copies the link when the share sheet is refused', async () => {
    const { shareTeamInvite } = await import('./utilMobileSignup');
    const writeText = vi.fn(async () => {});
    expect(
      await shareTeamInvite(url, {
        share: vi.fn(async () => {
          throw new DOMException('not allowed', 'NotAllowedError');
        }),
        clipboard: { writeText },
      })
    ).toBe('copied');
  });
});

describe('teamInviteUrl', () => {
  it('tags the homepage link as a team invite', async () => {
    const { teamInviteUrl } = await import('./utilMobileSignup');
    expect(teamInviteUrl('https://macro.com')).toBe(
      'https://macro.com/?utm_source=mobile_invite&utm_medium=share&utm_campaign=team_invite'
    );
  });
});
