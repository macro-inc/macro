import { EmailViewSkeleton } from '@app/features/email-view/email-view-skeleton';
import { SplitRouter } from '@app/lib/split-router';
import { ContentLoading } from '@components/app/ContentLoading';
import { EmailDetailRouteView, MailRouteView } from './lazy-route-views';
import { emailSplitRoute, emailThreadRoute } from './routes';

const { Route } = SplitRouter;

/**
 * The Email view and its thread. The thread route has its own loading view:
 * without it a thread that suspends while opening would swap the whole Email
 * view, list and sidebar included, for the Email skeleton.
 */
export function EmailRoutes() {
  return (
    <Route
      definition={emailSplitRoute}
      component={MailRouteView}
      loading={EmailViewSkeleton}
    >
      <Route
        definition={emailThreadRoute}
        component={EmailDetailRouteView}
        loading={ContentLoading}
      />
    </Route>
  );
}
