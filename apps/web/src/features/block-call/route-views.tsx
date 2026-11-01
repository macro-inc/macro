import { createSearchParams, useRouteParams } from '@app/lib/split-router';
import { callDetailRoute } from '@app/routes/routes';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy } from 'solid-js';
import { callDetailSearch } from './call-route';

const CallDetailView = lazy(async () => ({
  default: (await import('./views/CallDetailView')).CallDetailView,
}));

export const CallDetailRouteView = withAuth(() => {
  const params = useRouteParams(callDetailRoute);
  const [search] = createSearchParams(callDetailSearch);
  return (
    <CallDetailView
      callId={params.callId}
      transcriptId={search.transcriptId}
      messageId={search.messageId}
      seek={search.seek}
    />
  );
});
