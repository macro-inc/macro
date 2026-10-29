import '@app/index.css';
import { InboxCard } from '@app/features/next-soup/soup-view/views/inbox/InboxCard';
import {
  ChannelCardLayout,
  ChannelMessageCardLayout,
  ChannelThreadCardLayout,
} from '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  ChannelLatestMessageNarrowBody,
  ChannelWideContent,
} from '@entity/composed/list-entity/channel';
import type {
  ChannelEntity,
  ChannelMessageEntity,
  ChannelThreadEntity,
} from '@entity/types/entity';
import type { Notification } from '@entity/types/notification';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { StaticMarkdown, StaticMarkdownContext } from '../StaticMarkdown';

const content =
  '**Read** [Roadmap](https://example.com/roadmap) with <m-user-mention>{"userId":"preview-user","email":"alex@example.com","displayName":"Alex"}</m-user-mention>';
const message = {
  messageId: 'preview-message',
  content,
  senderId: 'preview-user',
  createdAt: '2026-10-19T12:00:00Z',
  mentions: [],
};
const channel: ChannelEntity = {
  id: 'preview-channel',
  name: 'Preview channel',
  ownerId: 'preview-user',
  type: 'channel',
  channelType: 'public',
  latestMessage: message,
  latestRootMessage: message,
};
const channelMessage: ChannelMessageEntity = {
  id: 'preview-message',
  name: 'Preview channel',
  ownerId: 'preview-user',
  type: 'channel_message',
  channelId: channel.id,
  channelName: channel.name,
  channelType: 'public',
  messageId: message.messageId,
  senderId: message.senderId,
  content,
};
const thread: ChannelThreadEntity = {
  id: 'preview-thread',
  name: 'Preview channel',
  ownerId: 'preview-user',
  type: 'channel_thread',
  channelId: channel.id,
  channelType: 'public',
  messageId: message.messageId,
  threadId: 'preview-thread',
  senderId: message.senderId,
  sender: { type: 'user', id: 'preview-user' },
  content: `Original ${content}`,
  attachments: [],
  reactions: [],
  thread: { replyCount: 1, preview: [] },
};
const notification: Notification = {
  id: 'preview-notification',
  entity_id: channel.id,
  entity_type: 'channel',
  created_at: message.createdAt,
  updated_at: message.createdAt,
  sent: true,
  state: 'unseen',
  sender_id: message.senderId,
  notification_event_type: 'channel_message_reply',
  notification_metadata: {
    tag: 'channel_message_reply',
    content: {
      channelName: channel.name,
      channelType: 'public',
      messageId: 'preview-reply',
      threadId: thread.threadId,
      messageContent: content,
    },
  },
};

function Fixture() {
  document.documentElement.dataset.touchDevice = String(isTouchDevice());
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const [opened, setOpened] = createSignal('None');
  const [openCount, setOpenCount] = createSignal(0);
  const open = (id: string) => {
    setOpened(id);
    setOpenCount((count) => count + 1);
  };
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <StaticMarkdownContext>
              <main
                class="p-4 bg-page text-ink space-y-4"
                style={{
                  '--title-width': '160px',
                  '--soup-row-padding-l': '8px',
                }}
              >
                <h1>Channel preview accessibility</h1>
                <div data-testid="wide" class="mobile:hidden">
                  <InboxCard.Root class="flex" onClick={() => open('wide')}>
                    <ChannelWideContent entity={channel} showLatestMessage />
                  </InboxCard.Root>
                </div>
                <div data-testid="narrow">
                  <InboxCard.Root class="block" onClick={() => open('narrow')}>
                    <ChannelLatestMessageNarrowBody message={message} />
                  </InboxCard.Root>
                </div>
                <div data-testid="channel">
                  <ChannelCardLayout
                    item={{ entity: channel, unread: true }}
                    onClick={() => open('channel')}
                  />
                </div>
                <div data-testid="message">
                  <ChannelMessageCardLayout
                    item={{ entity: channelMessage, unread: true }}
                    onClick={() => open('message')}
                  />
                </div>
                <div data-testid="thread">
                  <ChannelThreadCardLayout
                    item={{ entity: thread, notification, unread: true }}
                    onClick={() => open('thread')}
                  />
                </div>
                <p role="status">
                  Opened: {opened()} ({openCount()})
                </p>
                <h2>Opened conversation</h2>
                <div data-testid="conversation">
                  <StaticMarkdown markdown={content} />
                </div>
              </main>
            </StaticMarkdownContext>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
