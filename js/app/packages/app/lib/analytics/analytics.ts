import type { AllTrackingEventValues } from '@app/lib/analytics/app-events';

type EventNames = AllTrackingEventValues | (string & {});

type TrackFn = (event: EventNames, data?: Record<string, unknown>) => void;

interface UserIdentifyInfo {
  email: string;
  os: string;
}

export interface Provider {
  id: string;
  track: TrackFn;
  initialize: () => void;
  identify?: (userID: string, info: Partial<UserIdentifyInfo>) => void;
}

export const createAnalyticsProvider = (provider: Provider): Provider => {
  let initialized = false;

  return {
    ...provider,
    initialize() {
      if (initialized) return;

      provider.initialize();

      initialized = true;
    },
  };
};

interface CreateAnalyticsOptions {
  providers: Provider[];
  initializeOnCreate?: boolean;
  disabled?: boolean;
}

export const createAnalytics = (options: CreateAnalyticsOptions) => {
  const providers: Provider[] = [...options.providers];

  const initializeProviders = () => {
    for (const provider of providers) {
      provider.initialize();
    }
  };

  if (options.initializeOnCreate !== false && !options.disabled) {
    initializeProviders();
  }

  const registerProvider = (provider: Provider) => {
    providers.push(provider);
  };

  const track = (event: EventNames, data?: Record<string, unknown>) => {
    if (options.disabled) return;

    for (const provider of providers) {
      provider.track(event, data);
    }
  };

  const trackProvider = (
    providerID: string,
    event: EventNames,
    data?: Record<string, unknown>
  ) => {
    if (options.disabled) return;

    for (const provider of providers) {
      if (provider.id !== providerID) continue;

      provider.track(event, data);
    }
  };

  const identify = (userID: string, info: Partial<UserIdentifyInfo>) => {
    if (options.disabled) return;

    for (const provider of providers) {
      provider.identify?.(userID, info);
    }
  };

  return {
    initializeProviders,
    registerProvider,

    track,
    trackProvider,
    identify,
  };
};

export type AnalyticsInterface = {
  track: TrackFn;
  trackProvider: (
    providerID: string,
    event: EventNames,
    data?: Record<string, unknown>
  ) => void;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
};
