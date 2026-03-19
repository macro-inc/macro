import type { AppEvents, AppEventNames } from '@app/lib/analytics/app-events';
import { usePosthog } from '@app/lib/analytics/posthog';
import {
  initializeGoogleAnalytics,
  initializeMetaPixel,
} from '@app/lib/analytics/providers';
import { match } from 'ts-pattern';

type AnalyticsProvider = 'ga' | 'meta-pixel' | 'posthog';

const DEFAULT_ANALYTICS_PROVIDERS: AnalyticsProvider[] = [];

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

interface CreateAnalyticsOptions {
  initializeOnCreate?: boolean;
  disabled?: boolean;
}

const GA_ID = 'G-52HPEL3FTV';

export const createAnalytics = (options: CreateAnalyticsOptions) => {
  const posthog = usePosthog();

  const initializeProviders = () => {
    if (options.disabled) return;

    try {
      initializeGoogleAnalytics();
      initializeMetaPixel();
    } catch (e) {
      console.error('[Analytics] Failed to initialize providers:', e);
    }
  };

  if (options.initializeOnCreate !== false && !options.disabled) {
    initializeProviders();
  }

  const sendEvent = (
    provider: AnalyticsProvider,
    event: EventName,
    data?: Record<string, unknown>
  ) => {
    if (options.disabled) return;

    try {
      match(provider)
        .with('ga', () => {
          gtag('event', event, data);
        })
        .with('meta-pixel', () => {
          fbq('track', event, data ?? {});
        })
        .with('posthog', () => {
          posthog.instance.capture(event, data);
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
    if (options.disabled) return;

    for (const provider of providersToSendTo) {
      sendEvent(provider, event, data);
    }
  };

  const identify = (userID: string, info: Partial<UserIdentifyInfo>) => {
    if (options.disabled) return;

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

      posthog.instance.identify(userID, { ...info });
    } catch (e) {
      console.error('[Analytics] Failed to identify user:', e);
    }
  };

  const reset = () => {
    if (options.disabled) return;

    try {
      gtag('config', GA_ID, { user_id: undefined });

      posthog.instance.reset();
    } catch (e) {
      console.error('[Analytics] Failed to reset:', e);
    }
  };

  return {
    initializeProviders,
    track,
    identify,
    reset,
  };
};

export type AnalyticsInterface = {
  track: TrackFn;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
  reset: () => void;
};
