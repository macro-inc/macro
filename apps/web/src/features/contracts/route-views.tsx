import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  RedirectSplit,
  usePageViewTracking,
  withAuth,
} from '@components/app/split-layout/split-router/app-route-shell';
import { enableContracts } from '@core/constant/featureFlags';
import { Show } from 'solid-js';
import { Contracts } from './contracts';

function ContractsPage() {
  usePageViewTracking('contracts');
  return <Contracts />;
}

export const ContractsRouteView = withAuth(() => {
  const flag = useFeatureFlag(enableContracts);
  return (
    <Show
      when={flag().enabled}
      fallback={
        <Show when={!flag().loading}>
          <RedirectSplit to={{ type: 'component', id: 'home' }} />
        </Show>
      }
    >
      <ContractsPage />
    </Show>
  );
});
