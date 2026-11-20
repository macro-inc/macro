import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { BookingLinksWorkspace } from './scheduling';

export const BookingLinksRouteView = withAuth(() => <BookingLinksWorkspace />);
