import {
  AppView,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { EmailView } from './email-view';
import { EmailViewSkeleton } from './email-view-skeleton';

export const MailRouteView = withAuth(() => {
  useViewRestoration();

  return (
    <AppView id="mail">
      <EmailView />
    </AppView>
  );
}, EmailViewSkeleton);
