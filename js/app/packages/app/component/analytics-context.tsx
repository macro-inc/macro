import {
  createAnalytics,
  googleAnalyticsProvider,
  metaPixelProvider,
} from '@app/lib/analytics';
import type { AnalyticsInterface } from '@app/lib/analytics/analytics';
import { createAssertedContextProvider } from '@core/context/createContext';

export const [AnalyticsContextProvider, useAnalytics] =
  createAssertedContextProvider<AnalyticsInterface>('analytics', () => {
    const analytics = createAnalytics({
      providers: [googleAnalyticsProvider, metaPixelProvider],
      disabled: import.meta.hot != null,
    });

    return analytics;
  });
