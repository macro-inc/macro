import {
  analytics,
  type AnalyticsInterface,
} from '@app/lib/analytics/analytics';
import { createAssertedContextProvider } from '@core/context/createContext';

export const [AnalyticsContextProvider, useAnalytics] =
  createAssertedContextProvider<AnalyticsInterface>('analytics', () => {
    return analytics;
  });
