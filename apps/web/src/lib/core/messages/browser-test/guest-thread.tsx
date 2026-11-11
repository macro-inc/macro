import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelInput } from '@channel/Input/ChannelInput';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { MaybeTauriProvider } from '@macro/tauri';
import { authKeys, type UserInfoData } from '@queries/auth/user-info';
import { queryClient } from '@queries/client';
import { getThreadRepliesQueryKey } from '@queries/messages/thread-replies';
import type {
  Message,
  MessageParent,
  MessageThread as ThreadData,
} from '@service-storage/messages';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { MessageThread, threadListItem } from '../MessageThread';
import {
  MessageSenderNameProvider,
  MessageTransportProvider,
  MessageViewerProvider,
} from '../message-transport';

const parent: MessageParent = {
  type: 'call',
  id: '00000000-0000-7000-8000-0000000ca110',
};
const viewerId = 'guest|00000000-0000-7000-8000-000000000001';
const namedReaction = {
  emoji: '👏',
  users: ['guest|00000000-0000-5000-8000-000000000002'],
};
const root: Message = {
  id: parent.id,
  parent,
  kind: 'call_root',
  sender_id: 'guest|00000000-0000-5000-8000-000000000001',
  imported_author: { name: 'Host' },
  content: '',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const replies: Message[] = [
  {
    ...root,
    id: 'participant-message',
    kind: 'message',
    content: 'Participant message',
    sender_id: 'guest|00000000-0000-5000-8000-000000000002',
    imported_author: { name: 'Participant' },
    thread_id: root.id,
    reactions: [namedReaction],
  },
  {
    ...root,
    id: 'guest-message',
    kind: 'message',
    content: 'Guest message',
    sender_id: 'guest|00000000-0000-7000-8000-000000000002',
    guest_name: 'Guest',
    imported_author: undefined,
    thread_id: root.id,
  },
  {
    ...root,
    id: 'own-message',
    kind: 'message',
    content: 'Own message',
    sender_id: viewerId,
    guest_name: 'Me',
    imported_author: undefined,
    thread_id: root.id,
    reactions: [{ emoji: '👍', users: [viewerId] }],
  },
];
const state: ThreadData['state'] = {
  root_id: root.id,
  user_id: root.sender_id,
  anchor: null,
  resolved: false,
  created_at: root.created_at,
  updated_at: root.updated_at,
};
const [thread, setThread] = createSignal<ThreadData>({ root, replies, state });
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: false,
  permissions: [],
} as unknown as UserInfoData);
queryClient.setQueryData(getThreadRepliesQueryKey(parent, root.id), thread());

function updateReplies(update: (items: Message[]) => Message[]) {
  const next = { ...thread(), replies: update(thread().replies) };
  setThread(next);
  queryClient.setQueryData(getThreadRepliesQueryKey(parent, root.id), next);
}

function Fixture() {
  useHotKeyRoot();
  const [lastAction, setLastAction] = createSignal('');
  const transport = {
    patch: async ({
      id,
      content,
    }: {
      parent: MessageParent;
      id: string;
      content: string;
    }) => {
      updateReplies((items) =>
        items.map((item) => (item.id === id ? { ...item, content } : item))
      );
      setLastAction(`edit:${id}`);
    },
    remove: async ({ id }: { parent: MessageParent; id: string }) => {
      updateReplies((items) =>
        items.map((item) =>
          item.id === id
            ? { ...item, deleted_at: '2026-01-02T00:00:00Z' }
            : item
        )
      );
      setLastAction(`delete:${id}`);
    },
    react: async ({
      id,
      emoji,
      add,
    }: {
      parent: MessageParent;
      id: string;
      emoji: string;
      add: boolean;
    }) => {
      updateReplies((items) =>
        items.map((item) =>
          item.id === id
            ? {
                ...item,
                reactions: add ? [{ emoji, users: [viewerId] }] : [],
              }
            : item
        )
      );
      setLastAction(`react:${id}:${add}`);
    },
  };
  return (
    <QueryClientProvider client={queryClient}>
      <MaybeTauriProvider>
        <AnalyticsContextProvider>
          <PosthogProvider>
            <EntityProvider>
              <UserContextProvider>
                <EmailLinksContextProvider>
                  <ChannelsContextProvider>
                    <QuickAccessProvider>
                      <MessageViewerProvider viewerId={() => viewerId}>
                        <MessageTransportProvider value={transport}>
                          <MessageSenderNameProvider
                            resolve={(senderId) => {
                              const message = [
                                thread().root,
                                ...thread().replies,
                              ].find((item) => item.sender_id === senderId);
                              return (
                                message?.imported_author?.name ??
                                message?.guest_name ??
                                undefined
                              );
                            }}
                          >
                            <main class="mx-auto flex h-screen max-w-[600px] flex-col bg-page p-4 text-ink">
                              <output aria-label="Last action">
                                {lastAction()}
                              </output>
                              <div class="min-h-0 flex-1 overflow-y-auto">
                                <MessageThread
                                  data={threadListItem(thread())}
                                  canWrite
                                  expanded
                                  hideReplyInput
                                />
                              </div>
                              <ChannelInput
                                parent={parent}
                                input={{
                                  id: 'guest-composer',
                                  mode: 'channel',
                                  placeholder: 'Message call',
                                }}
                                features={{
                                  mentions: false,
                                  createItems: false,
                                  gifs: false,
                                  richBlocks: false,
                                  attachments: false,
                                  dictation: false,
                                }}
                                onSend={async (snapshot) => {
                                  updateReplies((items) => [
                                    ...items,
                                    {
                                      ...root,
                                      id: `sent-${items.length}`,
                                      kind: 'message',
                                      sender_id: viewerId,
                                      guest_name: 'Me',
                                      imported_author: undefined,
                                      content: snapshot.value,
                                      thread_id: root.id,
                                    },
                                  ]);
                                  setLastAction('compose');
                                }}
                              />
                            </main>
                          </MessageSenderNameProvider>
                        </MessageTransportProvider>
                      </MessageViewerProvider>
                    </QuickAccessProvider>
                  </ChannelsContextProvider>
                </EmailLinksContextProvider>
              </UserContextProvider>
            </EntityProvider>
          </PosthogProvider>
        </AnalyticsContextProvider>
      </MaybeTauriProvider>
    </QueryClientProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
