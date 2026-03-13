import type { AppEvents, AppEventNames } from '@app/lib/analytics/app-events';
import {
  initializeGoogleAnalytics,
  initializeMetaPixel,
} from '@app/lib/analytics/providers';

type AnalyticsProvider = 'ga' | 'meta-pixel' | 'mixpanel';

const DEFAULT_ANALYTICS_PROVIDERS = [
  // 'mixpanel',
] as const satisfies AnalyticsProvider[];

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

export const createAnalytics = (options: CreateAnalyticsOptions) => {
  const initializeProviders = () => {
    if (options.disabled) return;

    initializeGoogleAnalytics();
    initializeMetaPixel();
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

    switch (provider) {
      case 'ga': {
        gtag('event', event, data);
        break;
      }
      case 'meta-pixel': {
        fbq('track', event, data ?? {});
        break;
      }
      case 'mixpanel': {
        break;
      }
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

    gtag('config', 'G-52HPEL3FTV', {
      ...info,
      user_id: userID,
    });
  };

  return {
    initializeProviders,

    track,
    identify,
  };
};

export type AnalyticsInterface = {
  track: TrackFn;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
};
