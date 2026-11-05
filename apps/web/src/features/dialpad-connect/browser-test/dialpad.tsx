import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
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
      <Show when={!item.hidden}>
        <IntegrationItemRow item={item} />
      </Show>
    </main>
  );
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
