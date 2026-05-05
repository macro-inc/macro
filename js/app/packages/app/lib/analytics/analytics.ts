import type { AppEvents, AppEventNames } from '@app/lib/analytics/app-events';
import {
  type GoogleConversionAction,
  googleConversionSendTo,
} from '@app/lib/analytics/googleConversions';
import {
  initializeGoogleAnalytics,
  initializeMetaPixel,
} from '@app/lib/analytics/providers';
import { PostHog } from 'posthog-js';
import { match } from 'ts-pattern';
import { getPlatform } from '@core/util/platform';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { DEV_MODE_ENV, PROD_MODE_ENV } from '@core/constant/featureFlags';

/**
 * Resolves the user's device context for analytics enrichment.
 *
 * `getPlatform()` runtime-detects via `isTauri()` + `@tauri-apps/plugin-os`:
 *   - Tauri iOS/Android → 'ios' | 'android' → 'mobile-app'
 *   - Tauri desktop OS → 'desktop' → 'desktop-app'
 *   - Plain browser → 'web'
 *
 * On web, `isTouchDevice()` (checks `pointer: coarse` media query) distinguishes
 * a phone/tablet browser ('mobile-web') from a desktop browser ('desktop-web').
 */
const DEVICE_PROPERTY = 'macro_device' as const;
const ENVIRONMENT_PROPERTY = 'macro_environment' as const;

function getEnvironment(): 'dev' | 'prod' | 'unknown' {
  if (PROD_MODE_ENV) return 'prod';
  if (DEV_MODE_ENV) return 'dev';
  return 'unknown';
}

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

// Meta Pixel distinguishes standard events (fbq('track', ...)) from custom
// events (fbq('trackCustom', ...)). Calling `track` with a non-standard name
// works but triggers Pixel Helper warnings and may affect Ads Manager
// categorization. https://developers.facebook.com/docs/meta-pixel/reference
const META_STANDARD_EVENT_NAMES = [
  'AddPaymentInfo',
  'AddToCart',
  'AddToWishlist',
  'CompleteRegistration',
  'Contact',
  'CustomizeProduct',
  'Donate',
  'FindLocation',
  'InitiateCheckout',
  'Lead',
  'PageView',
  'Purchase',
  'Schedule',
  'Search',
  'StartTrial',
  'SubmitApplication',
  'Subscribe',
  'ViewContent',
] as const;

export type MetaStandardEvent = (typeof META_STANDARD_EVENT_NAMES)[number];

const META_STANDARD_EVENTS: Set<string> = new Set(META_STANDARD_EVENT_NAMES);

const IGNORABLE_ERRORS = [
  // This error is reported very frequently but is not an actual issue.
  'ResizeObserver loop completed with undelivered notifications',
];

const initializePosthog = (instance: PostHog) => {
  const key = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!key) return;

  instance.init(key, {
    api_host: 'https://macro-prox.macroverse.workers.dev/i/ph',
    ui_host: 'https://us.posthog.com',
    defaults: '2026-01-30',
    before_send: (cr) => {
      if (cr?.event !== '$exception') return cr;

      const exceptionValues = cr.properties.$exception_values;

      if (!exceptionValues || !Array.isArray(exceptionValues)) return cr;

      if (IGNORABLE_ERRORS.some((e) => exceptionValues.includes(e))) {
        return null;
      }

      return cr;
    },
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

    const enriched = {
      ...data,
      [DEVICE_PROPERTY]: getDeviceType(),
      [ENVIRONMENT_PROPERTY]: getEnvironment(),
    };

    try {
      match(provider)
        .with('ga', () => {
          gtag('event', event, enriched);
        })
        .with('meta-pixel', () => {
          const fbqMethod = META_STANDARD_EVENTS.has(event)
            ? 'track'
            : 'trackCustom';
          fbq(fbqMethod, event, enriched);
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

  /**
   * Fires a Meta Pixel **standard** event via `fbq('track', ...)`. `event` is
   * typed to `MetaStandardEvent` (Lead, Purchase, CompleteRegistration, etc.),
   * so custom names and typos fail at compile time.
   *
   * Prefer this over `track(..., ['meta-pixel'])` for anything that maps to a
   * standard event: Meta's optimization models are pre-trained on the standard
   * taxonomy (faster learning-phase exit), standard events get priority slots
   * in iOS 14.5+ Aggregated Event Measurement, and Ads Manager surfaces them
   * natively in reports and conversion pickers.
   *
   * To split one standard event across multiple surfaces (e.g. two `Lead`
   * funnels), attach a `content_name` in `data` and filter on it via a Custom
   * Conversion in Ads Manager.
   *
   * For the rare event with no standard equivalent, fall back to
   * `track(event, data, ['meta-pixel'])` — that path uses `trackCustom`.
   */
  const trackMeta = (
    event: MetaStandardEvent,
    data?: Record<string, unknown>
  ) => {
    sendEvent('meta-pixel', event, data);
  };

  /**
   * Fires a Google Ads conversion via `gtag('event', 'conversion', ...)`.
   * `action` is typed to `GoogleConversionAction`, resolved to its `AW-{id}/{label}`
   * `send_to` via `googleConversionSendTo`.
   *
   * Pass `transaction_id` whenever possible — Google dedupes server-side on it,
   * which matters here because both call sites fire from `onMount` and a refresh
   * re-fires. A user id (post-signup) or the submitted email (mobile lead capture)
   * are both fine.
   *
   * Per-action `value` lets a single campaign optimize across multiple primaries
   * (Smart Bidding sums values across the goal). See `googleConversions.ts`.
   */
  const trackGoogleConversion = (
    action: GoogleConversionAction,
    data?: { value?: number; currency?: string; transaction_id?: string }
  ) => {
    if (disabled) return;

    try {
      gtag('event', 'conversion', {
        send_to: googleConversionSendTo(action),
        ...data,
      });
    } catch (e) {
      console.error('[Analytics] Failed to send Google Ads conversion:', e);
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
    const environment = getEnvironment();

    try {
      gtag('event', 'page_view', {
        [DEVICE_PROPERTY]: deviceType,
        [ENVIRONMENT_PROPERTY]: environment,
        page_title: pageTitle,
        page_location: pageLocation,
        page_path: pagePath,
      });

      fbq('track', 'PageView', {
        [DEVICE_PROPERTY]: deviceType,
        [ENVIRONMENT_PROPERTY]: environment,
        content_name: pageTitle,
      });

      posthog.capture('$pageview', {
        [DEVICE_PROPERTY]: deviceType,
        [ENVIRONMENT_PROPERTY]: environment,
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
    trackMeta,
    trackGoogleConversion,
    identify,
    reset,
    pageView,
  };
};

export type AnalyticsInterface = {
  posthog: PostHog;
  track: TrackFn;
  trackMeta: (event: MetaStandardEvent, data?: Record<string, unknown>) => void;
  trackGoogleConversion: (
    action: GoogleConversionAction,
    data?: { value?: number; currency?: string; transaction_id?: string }
  ) => void;
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
