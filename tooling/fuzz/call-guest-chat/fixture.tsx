import type { UserInfoData } from '@queries/auth/user-info';
import type { MessageThread as ThreadData } from '@service-storage/messages';
import { Route, Router } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';

type Corpus = { viewerId: string; threads: ThreadData[] };
document.body.dataset.stage = 'imports';
await import('@app/index.css');
document.body.dataset.stage = 'channel-input';
const { ChannelInput } = await import('@channel/Input/ChannelInput');
const { DragDropProvider } = await import('@thisbeyond/solid-dnd');
const { buildPostMessageRequest } = await import(
  '@channel/Input/message-payload'
);
document.body.dataset.stage = 'providers';
const { AnalyticsContextProvider } = await import(
  '@app/lib/analytics/analytics-context'
);
const { PosthogProvider } = await import('@app/lib/analytics/posthog');
const { ChannelsContextProvider } = await import('@core/context/channels');
const { EmailLinksContextProvider } = await import('@core/context/emailLinks');
const { QuickAccessProvider } = await import(
  '@core/context/quickAccess/QuickAccessProvider'
);
const { UserContextProvider } = await import('@core/context/user');
const { useHotKeyRoot } = await import('@core/hotkey/hotkeys');
const { EntityProvider } = await import('@entity');
const { MaybeTauriProvider } = await import('@macro/tauri');
const { authKeys } = await import('@queries/auth/user-info');
const { queryClient } = await import('@queries/client');
const { getThreadRepliesQueryKey } = await import(
  '@queries/messages/thread-replies'
);
const { entityMessagesClient } = await import('@service-storage/messages');
document.body.dataset.stage = 'message-thread';
const { MessageThread, threadListItem } = await import(
  '@core/messages/MessageThread'
);
document.body.dataset.stage = 'loaded-components';
document.body.dataset.stage = 'loading-corpus';
const corpus = (await (await fetch('/__cgc_corpus')).json()) as Corpus;
document.body.dataset.stage = 'loaded-corpus';
const { AppProviders } = await import('@components/app/AppProviders');
document.body.dataset.stage = 'loaded-app-providers';
queryClient.setDefaultOptions({
  queries: { retry: false, refetchOnWindowFocus: false },
});
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  id: corpus.viewerId,
  userId: corpus.viewerId,
  permissions: [],
} as unknown as UserInfoData);
for (const thread of corpus.threads) {
  queryClient.setQueryData(
    getThreadRepliesQueryKey(thread.root.parent, thread.root.id),
    thread
  );
}

function Fixture() {
  useHotKeyRoot();
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
                      <Router>
                        <Route path="*" component={SignedInSurface} />
                      </Router>
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

function SignedInSurface() {
  const [actions, setActions] = createSignal('');
  return (
    <AppProviders>
      <DragDropProvider>
        <main class="mx-auto h-screen max-w-[700px] overflow-y-auto bg-page p-4 text-ink">
          <output aria-label="Action">{actions()}</output>
          <For each={corpus.threads}>
            {(thread) => (
              <section data-case-id={thread.root.id}>
                <MessageThread data={threadListItem(thread)} canWrite />
                <ChannelInput
                  parent={thread.root.parent}
                  input={{
                    id: `composer-${thread.root.id}`,
                    mode: 'channel',
                    placeholder: 'Message',
                    attachments:
                      thread.root.sender_id === corpus.viewerId
                        ? [
                            {
                              id: 'fixture-document',
                              name: 'fixture.txt',
                              kind: 'document',
                            },
                          ]
                        : [],
                  }}
                  onSend={async (snapshot) => {
                    try {
                      await entityMessagesClient.post(thread.root.parent, {
                        ...buildPostMessageRequest({ snapshot }),
                        nonce: 'fixture-send',
                      });
                    } catch {
                      // The browser fixture records the request and blocks it.
                    }
                    setActions(`send:${thread.root.id}`);
                  }}
                />
              </section>
            )}
          </For>
        </main>
      </DragDropProvider>
    </AppProviders>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
document.body.dataset.stage = 'rendered';
