import { createAnalytics } from '@app/lib/analytics';
import type { AnalyticsInterface } from '@app/lib/analytics/analytics';
import { createAssertedContextProvider } from '@core/context/createContext';

export const [AnalyticsContextProvider, useAnalytics] =
  createAssertedContextProvider<AnalyticsInterface>('analytics', () => {
    const analytics = createAnalytics({
      disabled: import.meta.env.DEV,
    });

    return analytics;
  });
