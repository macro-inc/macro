import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { driveCallRoute } from '@app/routes/routes';
import { callDetailSearch } from '@block-call/call-route';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  AppView,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { useIsAuthenticated } from '@core/auth';
import { lazy, Show } from 'solid-js';
import {
  DriveView,
  type DriveViewProps,
  SignedOutDriveView,
} from './drive-view';
import { DriveViewSkeleton } from './drive-view-skeleton';

const DriveCallDetail = lazy(async () => ({
  default: (await import('./views/DriveCallDetail')).DriveCallDetail,
}));

const AuthenticatedDriveRouteView = withAuth(() => {
  const panel = useSplitPanelOrThrow();
  const props = (): DriveViewProps => {
    const content = panel.handle.content();
    return content.type === 'component'
      ? ((content.params ?? {}) as DriveViewProps)
      : {};
  };
  return (
    <AppView id="documents">
      <DriveView initialFacets={props().initialFacets} />
    </AppView>
  );
}, DriveViewSkeleton);

export function DriveRouteView() {
  const authenticated = useIsAuthenticated();
  return (
    <Show
      when={authenticated() === false}
      fallback={<AuthenticatedDriveRouteView />}
    >
      <SignedOutDriveView />
    </Show>
  );
}

export function DriveCallRouteView() {
  const params = useRouteParams(driveCallRoute);
  const [search] = createSearchParams(callDetailSearch);
  return (
    <DriveCallDetail
      callId={params.callId}
      transcriptId={search.transcriptId}
      messageId={search.messageId}
      seek={search.seek}
    />
  );
}
