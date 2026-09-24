import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { defineRoute, useRouteParams } from '@app/lib/split-router';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { lazy, onMount } from 'solid-js';
import { z } from 'zod';
import { callDetailSearch } from './call-route';
import { URL_PARAMS } from './constants';

const CallDetailView = lazy(async () => ({
  default: (await import('./views/CallDetailView')).CallDetailView,
}));

const CallDetailRouteView = withAuth(() => {
  const params = useRouteParams(callDetailRoute);
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('call');
    analytics.track('open_entity', {
      entityType: 'call',
      entityId: params.callId,
    });
  });
  return <CallDetailView callId={params.callId} />;
});

export const callDetailRoute = defineRoute({
  id: 'call-detail',
  path: 'call/:callId',
  params: z.object({ callId: z.string().min(1) }),
  search: [callDetailSearch.namespace],
  externalSearch: [URL_PARAMS.transcriptId],
  component: CallDetailRouteView,
  remountKey: ({ callId }) => callId,
  claim: ({ callId }) => ({ namespace: 'block', id: `call:${callId}` }),
});
