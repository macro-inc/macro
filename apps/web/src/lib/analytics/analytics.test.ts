import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web' as 'web' | 'ios' | 'android' | 'desktop',
  touch: false,
  capture: vi.fn(),
  identify: vi.fn(),
  init: vi.fn(),
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
    init = mocks.init;
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

describe('PostHog exception frames', () => {
  async function beforeSendException(value: string, filenames: string[]) {
    vi.stubEnv('VITE_POSTHOG_API_KEY', 'test-key');
    await import('./analytics');
    const beforeSend = mocks.init.mock.calls[0][1].before_send;
    return beforeSend({
      event: '$exception',
      properties: {
        $exception_values: [value],
        $exception_list: [
          {
            type: 'Error',
            value,
            stacktrace: {
              type: 'raw',
              frames: filenames.map((filename) => ({
                platform: 'web:javascript',
                filename,
                lineno: 27,
                colno: 40048,
              })),
            },
          },
        ],
      },
    });
  }

  async function sendException(filenames: string[]) {
    const event = await beforeSendException('boom', filenames);
    return event.properties.$exception_list[0].stacktrace.frames.map(
      (frame: { filename: string }) => frame.filename
    );
  }

  it('drops the ResizeObserver loop warning, which browsers report with a trailing period', async () => {
    expect(
      await beforeSendException(
        'ResizeObserver loop completed with undelivered notifications.',
        ['https://macro.com/app/app-gifhAVYj.js']
      )
    ).toBeNull();
  });

  it('drops errors thrown by browser extensions', async () => {
    expect(
      await beforeSendException(
        "Cannot read properties of undefined (reading 'M_ID')",
        [
          'https://macro.com/app/app-gifhAVYj.js',
          'chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/content.js',
        ]
      )
    ).toBeNull();
  });

  it('keeps app errors that only pass through an extension frame', async () => {
    expect(
      await beforeSendException('boom', [
        'chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/content.js',
        'https://macro.com/app/app-gifhAVYj.js',
      ])
    ).not.toBeNull();
  });

  it.each(['ios', 'android', 'desktop'] as const)(
    'points %s bundle frames at the public web bundle so PostHog can fetch its source map',
    async (platform) => {
      mocks.platform = platform;

      expect(
        await sendException([
          'tauri://localhost/app/app-xMZRw8gs.js',
          'https://tauri.localhost/app/chunk-AbC123.js',
          'http://tauri.localhost/app/chunk-AbC123.js',
          'tauri://localhost',
          'https://cdn.example.com/app/vendor.js',
        ])
      ).toEqual([
        'https://macro.com/app/app-xMZRw8gs.js',
        'https://macro.com/app/chunk-AbC123.js',
        'https://macro.com/app/chunk-AbC123.js',
        'tauri://localhost',
        'https://cdn.example.com/app/vendor.js',
      ]);
    }
  );

  it('leaves web frames untouched', async () => {
    expect(
      await sendException(['https://macro.com/app/app-gifhAVYj.js'])
    ).toEqual(['https://macro.com/app/app-gifhAVYj.js']);
  });
});
