import type { AppEvents, AppEventNames } from '@app/lib/analytics/app-events';
import {
  initializeGoogleAnalytics,
  initializeMetaPixel,
} from '@app/lib/analytics/providers';
import { PostHog } from 'posthog-js';
import { match } from 'ts-pattern';
import { getPlatform } from '@core/util/platform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Resolves the user's device context for analytics enrichment.
 *
 * `getPlatform()` reads the build-time `VITE_PLATFORM` env var:
 *   - Tauri iOS/Android builds → 'ios' | 'android' → 'mobile-app'
 *   - Tauri desktop build → 'desktop' → 'desktop-app'
 *   - Web build → 'web' (used by both desktop and mobile browsers)
 *
 * Desktop and mobile browsers share the same web build, so we use
 * `isTouchDevice()` (checks `pointer: coarse` media query) to distinguish
 * a phone/tablet browser ('mobile-web') from a desktop browser ('desktop-web').
 */
const DEVICE_PROPERTY = 'macro_device' as const;

function getDeviceType():
  | 'desktop-app'
  | 'desktop-web'
  | 'mobile-web'
  | 'mobile-app' {
  const platform = getPlatform();
  if (platform === 'ios' || platform === 'android') return 'mobile-app';
  if (platform === 'desktop') return 'desktop-app';
  return isTouchDevice() ? 'mobile-web' : 'desktop-web';
}

export type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';

const DEFAULT_ANALYTICS_PROVIDERS: AnalyticsProvider[] = ['posthog'];

type EventName = AppEventNames | (string & {});

type TrackFn = <E extends EventName>(
  event: E,
  data?: E extends keyof AppEvents ? AppEvents[E] : Record<string, unknown>,
  providersToSendTo?: AnalyticsProvider[]
) => void;

interface UserIdentifyInfo {
  email: string;
  os: string;
}

interface PageViewOptions {
  /** Override the page path (defaults to window.location.pathname) */
  path?: string;
  /** Override the page location/URL (defaults to window.location.href) */
  location?: string;
}

const GA_ID = 'G-52HPEL3FTV';

const initializePosthog = (instance: PostHog) => {
  const key = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!key) return;

  instance.init(key, {
    api_host: 'https://macro-prox.macroverse.workers.dev/i/ph',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
  });
};

const tryInitialize = (callback: VoidFunction) => {
  try {
    callback();
  } catch (e) {
    console.error('[Analytics] Failed to initialize providers:', e);
  }
};

export const createAnalytics = () => {
  const posthog = new PostHog();

  const disabled = import.meta.env.DEV === true;

  const initializeProviders = () => {
    if (disabled) return;

    tryInitialize(initializeGoogleAnalytics);
    tryInitialize(initializeMetaPixel);
    tryInitialize(() => initializePosthog(posthog));
  };

  initializeProviders();

  const sendEvent = (
    provider: AnalyticsProvider,
    event: EventName,
    data?: Record<string, unknown>
  ) => {
    if (disabled) return;

    const enriched = { ...data, [DEVICE_PROPERTY]: getDeviceType() };

    try {
      match(provider)
        .with('ga', () => {
          gtag('event', event, enriched);
        })
        .with('meta-pixel', () => {
          fbq('track', event, enriched);
        })
        .with('posthog', () => {
          posthog.capture(event, enriched);
        })
        .exhaustive();
    } catch (e) {
      console.error(`[Analytics] Failed to send event to ${provider}:`, e);
    }
  };

  const track: TrackFn = (
    event: EventName,
    data?: Record<string, unknown>,
    providersToSendTo: AnalyticsProvider[] = DEFAULT_ANALYTICS_PROVIDERS
  ) => {
    for (const provider of providersToSendTo) {
      sendEvent(provider, event, data);
    }
  };

  const identify = (userID: string, info: Partial<UserIdentifyInfo>) => {
    if (disabled) return;

    try {
      gtag('config', GA_ID, {
        user_id: userID,
        ...(info.email && { email: info.email }),
        ...(info.os && { os: info.os }),
      });

      fbq('init', '639142540393286', {
        external_id: userID,
        em: info.email,
      });

      posthog.identify(userID, { ...info });
    } catch (e) {
      console.error('[Analytics] Failed to identify user:', e);
    }
  };

  const reset = () => {
    if (disabled) return;

    try {
      gtag('config', GA_ID, { user_id: undefined });

      posthog.reset();
    } catch (e) {
      console.error('[Analytics] Failed to reset:', e);
    }
  };

  const pageView = (pageTitle: string, opts?: PageViewOptions) => {
    if (disabled) return;

    const pagePath = opts?.path ?? window.location.pathname;
    const pageLocation = opts?.location ?? window.location.href;
    const deviceType = getDeviceType();

    try {
      gtag('event', 'page_view', {
        [DEVICE_PROPERTY]: deviceType,
        page_title: pageTitle,
        page_location: pageLocation,
        page_path: pagePath,
      });

      fbq('track', 'PageView', {
        [DEVICE_PROPERTY]: deviceType,
        content_name: pageTitle,
      });

      posthog.capture('$pageview', {
        [DEVICE_PROPERTY]: deviceType,
        $current_url: pageLocation,
        $pathname: pagePath,
        $title: pageTitle,
      });
    } catch (e) {
      console.error('[Analytics] Failed to send page_view:', e);
    }
  };

  return {
    posthog,
    initializeProviders,
    track,
    identify,
    reset,
    pageView,
  };
};

export type AnalyticsInterface = {
  posthog: PostHog;
  track: TrackFn;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
  reset: () => void;
  pageView: (pageTitle: string, opts?: PageViewOptions) => void;
};

/**
 * Singleton analytics instance for use in utility functions that cannot use hooks.
 *
 * @deprecated **Do not use in components.** Use `useAnalytics()` hook from
 * `@app/component/analytics-context` instead. This singleton exists only for
 * standalone utility functions (e.g., upload.ts) that run outside Solid context.
 */
export const analytics = createAnalytics();
