import { ViewBreadcrumbs } from '@app/components/view-shell';
import { SplitRouter } from '@app/lib/split-router';
import { VisitorDetail } from '@components/app/split-layout/split-router/app-route-shell';
import { LoginButton } from '@core/component/TopBar/LoginButton';
import { EmptyStatePanel } from '@ui';
import { Show, Suspense } from 'solid-js';
import { useDriveDetailNavigation } from '../drive-detail-navigation';
import { DriveLoading } from './drive-workspace';

export function SignedOutDriveWorkspace() {
  const navigation = useDriveDetailNavigation();
  return (
    <ViewBreadcrumbs.Root
      value={navigation.active()?.value ?? ''}
      onChange={navigation.popTo}
    >
      <VisitorDetail>
        <Show
          when={navigation.active()}
          fallback={
            <EmptyStatePanel
              centered
              title="Sign in to view your files"
              description="Your files and folders are available after you sign in."
            >
              <LoginButton />
            </EmptyStatePanel>
          }
        >
          <Suspense fallback={<DriveLoading />}>
            <SplitRouter.Outlet />
          </Suspense>
        </Show>
      </VisitorDetail>
    </ViewBreadcrumbs.Root>
  );
}
