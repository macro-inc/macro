import { defineRoute } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';

const EmailMarketing = lazy(async () => ({
  default: (await import('./email-marketing')).EmailMarketing,
}));
export const EmailMarketingRouteView = withAuth(() => <EmailMarketing />);
export const emailMarketingRoute = defineRoute({
  id: 'view-email-marketing',
  path: 'email-marketing',
  component: EmailMarketingRouteView,
  claim: () => ({ namespace: 'component', id: 'email-marketing' }),
});
