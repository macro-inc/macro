import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';
import { makeInputValuePersistenceKey } from '../utils/persistence';

const CHANNELS = ['layout-one', 'layout-two'];

/**
 * The real channel composer in a box the test can resize, mounted per channel
 * as a channel's page mounts it (keyed by channel, over its stored draft).
 */
function Fixture() {
  useHotKeyRoot();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [channel, setChannel] = createSignal(CHANNELS[0]);
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelsContextProvider>
                <QuickAccessProvider>
                  <main class="min-h-screen bg-page p-4 text-ink space-y-4">
                    <nav class="flex gap-2">
                      <For each={CHANNELS}>
                        {(id) => (
                          <button
                            type="button"
                            aria-pressed={channel() === id}
                            onClick={() => setChannel(id)}
                          >
                            {id}
                          </button>
                        )}
                      </For>
                    </nav>
                    <div data-composer-host>
                      <Show when={channel()} keyed>
                        {(id) => (
                          <ChannelInput
                            input={{
                              mode: 'channel',
                              id: `channel-input-${id}`,
                              placeholder: `Message #${id}`,
                            }}
                            participants={() => []}
                            bots={() => []}
                            persistenceKey={makeInputValuePersistenceKey({
                              channelId: id,
                            })}
                          />
                        )}
                      </Show>
                    </div>
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
// Phones and tablets get the app's touch layout of the composer.
document.documentElement.dataset.touchDevice = String(isTouchDevice());
initializeLexical();
render(() => <Fixture />, root);
