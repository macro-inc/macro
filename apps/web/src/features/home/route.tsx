import { defineRoute } from '@app/lib/split-router';
import {
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';

const Home = lazy(async () => ({
  default: (await import('.')).Home,
}));

export const HomeRouteView = withAuth(() => {
  usePageViewTracking('home');
  return <Home />;
});

export const homeRoute = defineRoute({
  id: 'view-home',
  path: 'home',
  component: HomeRouteView,
  search: '*' as const,
  claim: () => ({ namespace: 'component', id: 'home' }),
});
