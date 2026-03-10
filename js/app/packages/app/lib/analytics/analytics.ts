interface UserIdentifyInfo {
  email: string;
  os: string;
}

export interface Provider {
  id: string;
  track: (event: string, data?: Record<string, unknown>) => void;
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
}

export const createAnalytics = (options: CreateAnalyticsOptions) => {
  const providers: Provider[] = [...options.providers];

  const initializeProviders = () => {
    for (const provider of providers) {
      provider.initialize();
    }
  };

  if (options.initializeOnCreate !== false) {
    initializeProviders();
  }

  const registerProvider = (provider: Provider) => {
    providers.push(provider);
  };

  const track = (event: string, data?: Record<string, unknown>) => {
    for (const provider of providers) {
      provider.track(event, data);
    }
  };

  const trackProvider = (
    providerID: string,
    event: string,
    data?: Record<string, unknown>
  ) => {
    for (const provider of providers) {
      if (provider.id !== providerID) continue;

      provider.track(event, data);
    }
  };

  const identify = (userID: string, info: Partial<UserIdentifyInfo>) => {
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
  track: (event: string, data?: Record<string, unknown>) => void;
  trackProvider: (
    providerID: string,
    event: string,
    data?: Record<string, unknown>
  ) => void;
  identify: (userID: string, info: Partial<UserIdentifyInfo>) => void;
};
