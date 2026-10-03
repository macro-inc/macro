import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';

const GettingStarted = lazy(async () => ({
  default: (await import('.')).GettingStarted,
}));

export const GettingStartedRouteView = withAuth(() => {
  usePageViewTracking('getting-started');
  return <GettingStarted />;
});
