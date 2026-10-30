import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import {
  enableEmailMarketing,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { lazy } from 'solid-js';

const EmailMarketing = lazy(async () => ({
  default: (await import('./email-marketing')).EmailMarketing,
}));

export const EmailMarketingRouteView = withAuth(() => {
  if (!isFeatureEnabled(enableEmailMarketing))
    return <RedirectSplit to={{ type: 'component', id: 'home' }} />;
  usePageViewTracking('email-marketing');
  return <EmailMarketing />;
});
