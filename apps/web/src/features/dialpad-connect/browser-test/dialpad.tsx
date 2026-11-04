import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { enableDialpad } from '@core/constant/featureFlags';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { Show } from 'solid-js';
import { render } from 'solid-js/web';
import { useDialpadItem } from '../../settings/connections/integration-items';
import { IntegrationItemRow } from '../../settings/connections/integrations-list';

/** The real Settings row; the test answers its Dialpad requests. */
function Fixture() {
  const item = useDialpadItem();
  return (
    <main class="p-6">
      <Show when={!item.hidden} fallback={<p>Dialpad unavailable</p>}>
        <IntegrationItemRow item={item} />
      </Show>
    </main>
  );
}

// The app's client: the Dialpad hooks write their results to it.
const params = new URLSearchParams(location.search);
if (params.get('flag') === 'off') enableDialpad.override = false;
if (params.has('connecting')) {
  queryClient.setQueryData(['dialpad', 'connection'], { state: 'connecting' });
}
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <Fixture />
          </PosthogProvider>
        </AnalyticsContextProvider>
      </QueryClientProvider>
    ),
    root
  );
