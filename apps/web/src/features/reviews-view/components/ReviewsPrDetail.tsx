import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useRouteParams } from '@app/lib/split-router';
import { reviewsPrRoute } from '@app/routes/routes';
import { PrPage } from '@block-pr/pr-page';
import { onMount } from 'solid-js';

export function ReviewsPrDetail(props: { foreignEntityId: string }) {
  const analytics = useAnalytics();
  onMount(() => {
    analytics.pageView('pr');
    analytics.track('open_entity', {
      entityType: 'pr',
      entityId: props.foreignEntityId,
    });
  });
  return <PrPage foreignEntityId={props.foreignEntityId} hosted />;
}

export function ReviewsPrDetailRouteView() {
  const params = useRouteParams(reviewsPrRoute);
  return <ReviewsPrDetail foreignEntityId={params.foreignEntityId} />;
}
