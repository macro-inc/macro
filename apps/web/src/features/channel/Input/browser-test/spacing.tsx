import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelInput } from '../ChannelInput';

/**
 * The real channel composer above the renderer channel messages use, so a
 * draft and the message it sends can be compared line for line.
 */
function Fixture() {
  useHotKeyRoot();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [sent, setSent] = createSignal<string[]>([]);
  return (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <ChannelsContextProvider>
                <QuickAccessProvider>
                  <main class="min-h-screen bg-page p-4 text-ink space-y-4">
                    <section data-sent-messages class="space-y-2">
                      <For each={sent()}>
                        {(markdown) => (
                          <div
                            data-sent-message
                            class="whitespace-pre-wrap wrap-break-word max-w-full text-base"
                          >
                            <StaticMarkdown
                              markdown={markdown}
                              theme={channelTheme}
                              target="internal"
                            />
                          </div>
                        )}
                      </For>
                    </section>
                    <ChannelInput
                      input={{
                        mode: 'channel',
                        id: 'channel-input-spacing',
                        placeholder: 'Message #spacing',
                      }}
                      participants={() => []}
                      bots={() => []}
                      onSend={(snapshot) => {
                        setSent((previous) => [...previous, snapshot.value]);
                      }}
                    />
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
