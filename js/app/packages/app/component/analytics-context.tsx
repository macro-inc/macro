import {
  type AnalyticsInterface,
  analytics,
} from '@app/lib/analytics/analytics';
import { createAssertedContextProvider } from '@core/context/createContext';

export const [AnalyticsContextProvider, useAnalytics] =
  createAssertedContextProvider<AnalyticsInterface>('analytics', () => {
    return analytics;
  });
