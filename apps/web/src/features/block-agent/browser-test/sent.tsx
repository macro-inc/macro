import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { AgentInput } from '../ui/AgentInput';

// The plus menu is under test, not mentions: an empty Quick Access source.
const QUICK_ACCESS: QuickAccessContextValue = {
  useList: (() => ({
    items: () => [],
    totalCount: () => 0,
    hasMore: () => false,
    isLoading: () => false,
    isLoadingMore: () => false,
    error: () => undefined,
    loadMore: async () => {},
  })) as QuickAccessContextValue['useList'],
  usesRecordSelection: () => false,
  usesSearchProjection: () => true,
  isLoading: () => false,
  refresh: () => {},
  getById: () => undefined,
  interactionForUser: () => undefined,
};

/**
 * The composer as a session block drives it: the parent owns the draft (as
 * `createSessionComposerDraft` does) and sends what the input hands over.
 */
function Fixture() {
  const [draft, setDraft] = createSignal('');
  const [sent, setSent] = createSignal<string[]>([]);
  return (
    <main class="flex min-h-screen flex-col justify-end bg-page p-4 text-ink">
      <ol data-testid="sent">
        <For each={sent()}>{(message) => <li>{message}</li>}</For>
      </ol>
      <div class="mx-auto w-full max-w-2xl">
        <AgentInput
          draft={draft()}
          onDraftChange={setDraft}
          onSend={(markdown) => setSent((all) => [...all, markdown])}
          onAttachFiles={() => {}}
          commands={() => []}
        />
      </div>
    </main>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
render(
  () => (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessContextProvider value={QUICK_ACCESS}>
                    <MobileSettingsProvider>
                      <MemoryRouter>
                        <Route path="*" component={Fixture} />
                      </MemoryRouter>
                    </MobileSettingsProvider>
                  </QuickAccessContextProvider>
                </ChannelsContextProvider>
              </EmailLinksContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  root
);
