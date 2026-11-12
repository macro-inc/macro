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
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { ImperativeDialogHost } from '@ui';
import { For, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';
import { createChannelMessageActions } from '../../Channel/create-channel-message-actions';
import { ChannelMessage } from '../ChannelMessage';

const VIEWER = 'macro|ada@example.com';

// The app's entry point does this; `touch:` styles follow it.
document.documentElement.dataset.touchDevice = String(isTouchDevice());

const ARTICLE = {
  url: 'https://news.example.com/2026/11/offline-first',
  title: 'Offline first, without the sync bugs',
  description:
    'What we learned moving a collaborative editor to local-first storage, and the three conflicts that still need a person to resolve them. The first is a rename racing a delete, the second is two people reordering the same list, and the third is an edit made on a device that was offline for longer than the history we keep. Each needed its own rule, and none of them could be merged away.',
  image_url: 'https://news.example.com/images/offline-first.png',
  favicon_url: 'https://news.example.com/favicon.ico',
};

const GUIDE = {
  url: 'https://docs.example.org/guide',
  title: 'Getting started guide',
  favicon_url: 'https://docs.example.org/favicon.ico',
};

type FixtureMessage = Pick<MessageData, 'id' | 'content' | 'link_previews'> & {
  sender_id?: string;
};

const MESSAGES: FixtureMessage[] = [
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
  {
    id: 'other',
    content: `Someone else's link: ${GUIDE.url}`,
    link_previews: [GUIDE],
    sender_id: 'macro|grace@example.com',
  },
];

function message(entry: FixtureMessage): MessageData {
  return {
    sender_id: VIEWER,
    ...entry,
    created_at: '2026-11-04T17:21:45.000Z',
    updated_at: '2026-11-04T17:21:45.000Z',
    attachments: [],
    reactions: [],
  };
}

/**
 * The messages as Ada sees them, with the channel's real actions. Removing
 * previews empties them here, where the app would ask the server.
 */
function Messages() {
  const [messages, setMessages] = createStore(MESSAGES.map(message));
  const getMessageActions = createChannelMessageActions({
    parent: () => ({ type: 'channel', id: 'fixture-channel' }),
    userId: () => VIEWER,
    deleteMessage: () => {},
    addReaction: () => {},
    removeReaction: () => {},
    removeLinkPreviews: ({ messageID }) => {
      setMessages((entry) => entry.id === messageID, 'link_previews', []);
    },
  });

  return (
    <main class="min-h-screen bg-page py-4 text-ink">
      <For each={messages}>
        {(entry) => (
          <div data-fixture-message={entry.id}>
            <ChannelMessage
              message={entry}
              actions={getMessageActions(entry)}
            />
          </div>
        )}
      </For>
    </main>
  );
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
                      <Messages />
                      <ImperativeDialogHost />
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
