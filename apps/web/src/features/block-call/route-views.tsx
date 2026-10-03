import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { callDetailRoute } from '@app/routes/routes';
import { createSearchParams, useRouteParams } from '@app/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, onMount } from 'solid-js';
import { callDetailSearch } from './call-route';

const StandaloneCallDetail = lazy(async () => ({
  default: (await import('./views/CallDetailView')).StandaloneCallDetail,
}));

export const CallDetailRouteView = withAuth(() => {
  const params = useRouteParams(callDetailRoute);
  const [search] = createSearchParams(callDetailSearch);
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('call');
    analytics.track('open_entity', {
      entityType: 'call',
      entityId: params.callId,
    });
  });
  return (
    <StandaloneCallDetail
      callId={params.callId}
      transcriptId={search.transcriptId}
      messageId={search.messageId}
      seek={search.seek}
    />
  );
});
