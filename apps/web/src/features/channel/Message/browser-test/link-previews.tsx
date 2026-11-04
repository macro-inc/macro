import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import type { MessageData } from '@core/messages/types';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { ChannelMessage } from '../ChannelMessage';

const MESSAGES: { id: string; content: string }[] = [
  {
    id: 'article',
    content:
      'Worth a read before Thursday: https://news.example.com/2026/11/offline-first',
  },
  {
    id: 'several',
    content: [
      'Notes from the review:',
      '<m-link>{"url":"https://docs.example.org/guide","text":"the guide","title":""}</m-link> covers setup,',
      'and https://news.example.com/2026/11/offline-first again for context.',
      'Also https://bare.example.net, which has no metadata,',
      'and https://dev.macro.com/app/md/0195d2dd-5de9-71f2-9d59-5d9734f1adb7.',
    ].join(' '),
  },
];

function message(id: string, content: string): MessageData {
  return {
    id,
    content,
    sender_id: 'macro|ada@example.com',
    created_at: '2026-11-04T17:21:45.000Z',
    updated_at: '2026-11-04T17:21:45.000Z',
    attachments: [],
    reactions: [],
  };
}

/** Production channel messages over synthetic data; the test serves the unfurls. */
function Fixture() {
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
                  <QuickAccessProvider>
                    <StaticMarkdownContext theme={channelTheme} host="channel">
                      <main class="min-h-screen bg-page py-4 text-ink">
                        <For each={MESSAGES}>
                          {(entry) => (
                            <div data-fixture-message={entry.id}>
                              <ChannelMessage
                                message={message(entry.id, entry.content)}
                              />
                            </div>
                          )}
                        </For>
                      </main>
                    </StaticMarkdownContext>
                  </QuickAccessProvider>
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
render(() => <Fixture />, root);
