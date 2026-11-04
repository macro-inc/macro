import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';

const BookingLinksWorkspace = lazy(async () => ({
  default: (await import('./scheduling')).BookingLinksWorkspace,
}));

export const BookingLinksRouteView = withAuth(() => <BookingLinksWorkspace />);
