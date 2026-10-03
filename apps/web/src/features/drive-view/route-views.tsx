import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { driveCallRoute } from '@app/routes/routes';
import { callDetailSearch } from '@block-call/call-route';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  AppView,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';
import { DriveView, type DriveViewProps } from './drive-view';

const DriveCallDetail = lazy(async () => ({
  default: (await import('./views/DriveCallDetail')).DriveCallDetail,
}));

export const DriveRouteView = withAuth(() => {
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
});

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
