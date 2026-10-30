import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

const chip = (date: string) =>
  `<m-date-mention>${JSON.stringify({ date, displayFormat: 'Today' })}</m-date-mention>`;

function Fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <StaticMarkdownContext>
              <main class="bg-page text-ink h-dvh overflow-y-auto p-6 space-y-6 max-w-3xl mx-auto">
                <h1 class="text-xl font-medium">Date chips</h1>
                <section
                  data-testid="whole-day"
                  class="border border-edge rounded p-4"
                >
                  <StaticMarkdown
                    markdown={`All emailed ${chip('2026-09-24')}, awaiting demo booking.`}
                  />
                </section>
                <section
                  data-testid="timed"
                  class="border border-edge rounded p-4"
                >
                  <StaticMarkdown
                    markdown={`Call at ${chip('2026-09-24T16:00:00-07:00')}.`}
                  />
                </section>
              </main>
            </StaticMarkdownContext>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
