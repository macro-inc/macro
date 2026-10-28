import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';
import { makeInputValuePersistenceKey } from '../utils/persistence';

const channelId = 'draft-fixture-channel';

/**
 * The real channel composer over the app shell's providers, in the order
 * `routes/Root.tsx` mounts them. Leaving the channel unmounts the composer;
 * opening it again mounts a fresh one over the persisted draft.
 */
function Fixture() {
  useHotKeyRoot();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [open, setOpen] = createSignal(true);
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelsContextProvider>
                <QuickAccessProvider>
                  <main class="min-h-screen bg-page p-4 text-ink space-y-4">
                    <h1>Channel composer draft</h1>
                    <button type="button" onClick={() => setOpen(!open())}>
                      {open() ? 'Leave channel' : 'Open channel'}
                    </button>
                    <Show when={open()}>
                      <ChannelInput
                        input={{
                          mode: 'channel',
                          id: `channel-input-${channelId}`,
                          placeholder: 'Message #draft-fixture',
                        }}
                        participants={() => []}
                        bots={() => []}
                        persistenceKey={makeInputValuePersistenceKey({
                          channelId,
                        })}
                      />
                    </Show>
                  </main>
                </QuickAccessProvider>
              </ChannelsContextProvider>
            </UserContextProvider>
          </EntityProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
