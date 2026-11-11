import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { buildAgentRoster } from '../core/roster';
import { NewChatPage } from '../views/NewChatPage';

const QUICK_ACCESS: QuickAccessContextValue = {
  useList: (() => ({
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
  })) as unknown as QuickAccessContextValue['useList'],
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

const ROSTER = buildAgentRoster({
  agents: [
    {
      bot: { id: 'dev-box', name: 'Dev box', handle: 'dev-box' },
      harness: 'macrod',
      harness_id: 'away',
      default_model: 'model',
    },
    {
      bot: { id: 'reviewer', name: 'Reviewer', handle: 'reviewer' },
      harness: 'macrod',
      harness_id: 'here',
      default_model: 'model',
    },
  ],
  runtimes: [
    { id: 'away', name: 'Dev box', connected: false },
    { id: 'here', name: 'Laptop', connected: true },
  ],
  cursorConnected: true,
  cursorNeedsConnection: false,
});

/** The real new conversation composer, menu, and picker over a fixed roster. */
function Fixture() {
  useHotKeyRoot();
  const [started, setStarted] = createSignal('');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessContextProvider value={QUICK_ACCESS}>
                    <main class="min-h-screen bg-page p-4 text-ink">
                      <output data-testid="started" hidden>
                        {started()}
                      </output>
                      <MobileSettingsProvider>
                        <NewChatPage
                          compact
                          roster={ROSTER}
                          rosterLoading={false}
                          onStart={({ prompt, botId }) =>
                            setStarted(JSON.stringify({ prompt, botId }))
                          }
                          onOpenRoster={() => {}}
                        />
                      </MobileSettingsProvider>
                    </main>
                  </QuickAccessContextProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () => (
    <MemoryRouter>
      <Route path="*" component={Fixture} />
    </MemoryRouter>
  ),
  root
);
