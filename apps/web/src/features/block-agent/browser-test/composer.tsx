import '@app/index.css';
import { MobileSettingsProvider } from '@app/features/settings/context/mobile-settings';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { toast } from '@core/component/Toast/Toast';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessContextProvider } from '@core/context/quickAccess/context';
import type { QuickAccessContextValue } from '@core/context/quickAccess/types';
import { UserContextProvider } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onMount, Show } from 'solid-js';
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
 * The composer an agent session block mounts, docked at the bottom of the
 * page like a session pane's. `?toast` raises a failure toast over it, as the
 * app does when an answer can't be sent, and keeps it up for a minute (or
 * `?toast=<ms>`); `?prompt` adds a persistent prompt above it. Each
 * send is counted on <body>. `?hidden` mounts the composer the way a parked
 * desktop tab keeps it (in place, `invisible` and `inert`), and Close
 * composer unmounts it.
 */
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [open, setOpen] = createSignal(true);

  onMount(() => {
    if (params.has('prompt')) {
      toast.custom(
        { title: 'Reconnect your calendar' },
        {
          region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
          persistent: true,
        }
      );
    }
    if (params.has('toast')) {
      toast.failure("Couldn't send your answer", {
        duration: Number(params.get('toast')) || 60_000,
      });
    }
  });

  return (
    <main class="relative flex min-h-screen flex-col justify-end bg-page p-4 text-ink">
      <ToastRegion />
      <button
        type="button"
        class="absolute left-4 top-4 rounded border border-edge px-2 py-1 text-sm"
        onClick={() => setOpen(false)}
      >
        Close composer
      </button>
      <Show when={open()}>
        <div
          class="mx-auto w-full max-w-2xl"
          classList={{
            'absolute inset-x-4 bottom-4 invisible': params.has('hidden'),
          }}
          inert={params.has('hidden') || undefined}
        >
          <AgentInput
            onSend={() => {
              const sent = Number(document.body.dataset.sent ?? 0);
              document.body.dataset.sent = String(sent + 1);
            }}
            onAttachFiles={() => {}}
            commands={() => []}
          />
        </div>
      </Show>
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
