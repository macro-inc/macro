import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios' | 'android' | 'desktop',
  touch: false,
  distinctId: 'anon-id',
  identified: false,
  capture: vi.fn(),
  identify: vi.fn(),
  gtag: vi.fn(),
  fbq: vi.fn(),
}));

vi.mock('@core/util/platform', () => ({
  getPlatform: () => mocks.platform,
  isTauri: () => mocks.platform !== 'web',
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/constant/featureFlags', () => ({
  DEV_MODE_ENV: false,
  PROD_MODE_ENV: true,
}));
vi.mock('posthog-js', () => ({
  PostHog: class {
    capture = mocks.capture;
    identify = mocks.identify;
    get_distinct_id = () => mocks.distinctId;
    _isIdentified = () => mocks.identified;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_POSTHOG_API_KEY', '');
  vi.stubGlobal('gtag', mocks.gtag);
  vi.stubGlobal('fbq', mocks.fbq);
  mocks.platform = 'web';
  mocks.touch = false;
  mocks.distinctId = 'anon-id';
  mocks.identified = false;
  localStorage.clear();
  mocks.identify.mockImplementation((id: string) => {
    // PostHog drops identify() when this browser is already identified as
    // someone else. Callers have to merge instead of switching.
    if (mocks.identified && mocks.distinctId !== id) return;
    mocks.distinctId = id;
    mocks.identified = true;
  });
});

afterEach(() => {
  document.head.replaceChildren();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function hasMetaPixel() {
  return document.head.innerHTML.includes('connect.facebook.net');
}

describe('Meta pixel platform support', () => {
  it.each(['ios', 'android', 'desktop'] as const)(
    'does not load or call Meta on %s, while keeping other analytics working',
    async (platform) => {
      mocks.platform = platform;
      // Native builds never install fbq. A missed guard would also prevent
      // the subsequent PostHog identify/pageview in the shared try blocks.
      vi.stubGlobal('fbq', undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { analytics } = await import('./analytics');

      analytics.initializeProviders();
      expect(hasMetaPixel()).toBe(false);
      expect(document.head.querySelector('noscript')).toBeNull();

      analytics.trackMeta('Lead');
      analytics.track('test_event', {}, ['meta-pixel', 'ga', 'posthog']);
      analytics.identify('test-user', {});
      analytics.pageView('Inbox');

      expect(mocks.identify).toHaveBeenCalledWith('test-user', {});
      expect(mocks.capture).toHaveBeenCalledWith(
        'test_event',
        expect.any(Object),
        undefined
      );
      expect(mocks.capture).toHaveBeenCalledWith(
        '$pageview',
        expect.objectContaining({ $title: 'Inbox' })
      );
      expect(mocks.gtag).toHaveBeenCalledWith(
        'event',
        'page_view',
        expect.objectContaining({ page_title: 'Inbox' })
      );
      expect(error).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    'keeps Meta initialization and tracking on web (touch: %s)',
    async (touch) => {
      mocks.touch = touch;
      const { analytics } = await import('./analytics');
      expect(hasMetaPixel()).toBe(true);

      analytics.trackMeta('Lead', {}, { eventID: 'test-lead' });
      analytics.track('test_custom_event', {}, ['meta-pixel']);
      analytics.identify('test-user', {});
      analytics.pageView('Inbox');

      expect(mocks.fbq).toHaveBeenCalledWith(
        'track',
        'Lead',
        expect.objectContaining({
          macro_device: touch ? 'mobile-web' : 'desktop-web',
        }),
        { eventID: 'test-lead' }
      );
      expect(mocks.fbq).toHaveBeenCalledWith(
        'trackCustom',
        'test_custom_event',
        expect.any(Object),
        undefined
      );
      expect(mocks.fbq).toHaveBeenCalledWith(
        'init',
        expect.any(String),
        expect.objectContaining({ external_id: 'test-user' })
      );
      expect(mocks.fbq).toHaveBeenCalledWith(
        'track',
        'PageView',
        expect.objectContaining({ content_name: 'Inbox' })
      );
    }
  );
});

describe('mobile capture linked to the account', () => {
  it('merges the normalized email into the account after identify', async () => {
    const { analytics } = await import('./analytics');
    analytics.identify('macro|person@example.com', {
      email: 'Person@Example.com',
    });

    expect(mocks.identify).toHaveBeenCalledWith('macro|person@example.com', {
      email: 'person@example.com',
    });
    expect(mocks.gtag).toHaveBeenCalledWith(
      'config',
      expect.any(String),
      expect.objectContaining({
        user_id: 'macro|person@example.com',
        email: 'person@example.com',
      })
    );
    expect(mocks.capture).toHaveBeenCalledWith('$merge_dangerously', {
      alias: 'person@example.com',
    });
    expect(mocks.distinctId).toBe('macro|person@example.com');

    analytics.identify('macro|person@example.com', {
      email: 'Person@Example.com',
    });
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });

  it('merges the account into a browser already identified as that email', async () => {
    mocks.distinctId = 'person@example.com';
    mocks.identified = true;
    const { analytics } = await import('./analytics');

    analytics.identify('macro|person@example.com', {
      email: 'Person@Example.com',
    });

    expect(mocks.distinctId).toBe('person@example.com');
    expect(mocks.capture).toHaveBeenCalledWith('$merge_dangerously', {
      alias: 'macro|person@example.com',
    });
  });

  it('does not merge a browser identified as a different account', async () => {
    mocks.distinctId = 'macro|other@example.com';
    mocks.identified = true;
    const { analytics } = await import('./analytics');

    analytics.linkMobileCapturePerson(
      'macro|person@example.com',
      'person@example.com'
    );

    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it('sets mobile-capture properties once and does not merge the email into itself', async () => {
    const { analytics } = await import('./analytics');
    analytics.identify('visitor@acme.com', {
      email: 'Visitor@Acme.com',
      setOnce: {
        mobile_capture_at: '2026-10-14T12:00:00.000Z',
        mobile_capture_device: 'mobile',
      },
    });

    expect(mocks.identify).toHaveBeenCalledWith(
      'visitor@acme.com',
      { email: 'visitor@acme.com' },
      {
        mobile_capture_at: '2026-10-14T12:00:00.000Z',
        mobile_capture_device: 'mobile',
      }
    );
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});
