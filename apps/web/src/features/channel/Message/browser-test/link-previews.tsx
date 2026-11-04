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

const ARTICLE = {
  url: 'https://news.example.com/2026/11/offline-first',
  title: 'Offline first, without the sync bugs',
  description:
    'What we learned moving a collaborative editor to local-first storage, and the three conflicts that still need a person to resolve them.',
  image_url: 'https://news.example.com/images/offline-first.png',
  favicon_url: 'https://news.example.com/favicon.ico',
};

const GUIDE = {
  url: 'https://docs.example.org/guide',
  title: 'Getting started guide',
  favicon_url: 'https://docs.example.org/favicon.ico',
};

const MESSAGES: Pick<MessageData, 'id' | 'content' | 'link_previews'>[] = [
  {
    id: 'article',
    content: `Worth a read before Thursday: ${ARTICLE.url}`,
    link_previews: [ARTICLE],
  },
  {
    id: 'several',
    content: [
      'Notes from the review:',
      `<m-link>{"url":"${GUIDE.url}","text":"the guide","title":""}</m-link> covers setup,`,
      `and ${ARTICLE.url} for context.`,
    ].join(' '),
    link_previews: [GUIDE, ARTICLE],
  },
  {
    id: 'pending',
    content: 'Previews not computed yet: https://later.example.net',
  },
];

function message(entry: (typeof MESSAGES)[number]): MessageData {
  return {
    ...entry,
    sender_id: 'macro|ada@example.com',
    created_at: '2026-11-04T17:21:45.000Z',
    updated_at: '2026-11-04T17:21:45.000Z',
    attachments: [],
    reactions: [],
  };
}

/** Production channel messages over synthetic data, previews included. */
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
                              <ChannelMessage message={message(entry)} />
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
