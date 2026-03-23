import type { AppEvents, AppEventNames } from '@app/lib/analytics/app-events';
import {
  initializeGoogleAnalytics,
  initializeMetaPixel,
} from '@app/lib/analytics/providers';
import { PostHog } from 'posthog-js';
import { match } from 'ts-pattern';

type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';

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

const GA_ID = 'G-52HPEL3FTV';

const initializePosthog = (instance: PostHog) => {
  const key = import.meta.env.VITE_POSTHOG_API_KEY;
  if (!key) return;

  instance.init(key, {
    api_host: 'https://analytics-proxy.macroverse.workers.dev/ingest/ph',
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

  const sendEvent = (
    provider: AnalyticsProvider,
    event: EventName,
    data?: Record<string, unknown>
  ) => {
    if (disabled) return;

    try {
      match(provider)
        .with('ga', () => {
          gtag('event', event, data);
        })
        .with('meta-pixel', () => {
          fbq('track', event, data ?? {});
        })
        .with('posthog', () => {
          posthog.capture(event, data);
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
    if (disabled) return;

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

  return {
    posthog,
    initializeProviders,
    track,
    identify,
    reset,
  };
};

export type AnalyticsInterface = {
  posthog: PostHog;
  track: TrackFn;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
  reset: () => void;
};

/**
 * Singleton analytics instance for use in utility functions that cannot use hooks.
 *
 * @deprecated **Do not use in components.** Use `useAnalytics()` hook from
 * `@app/component/analytics-context` instead. This singleton exists only for
 * standalone utility functions (e.g., upload.ts) that run outside Solid context.
 */
export const analytics = createAnalytics();
