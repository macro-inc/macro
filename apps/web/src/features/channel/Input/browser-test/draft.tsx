import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelsContextProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import type { MessageData } from '@core/messages/types';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { createMessageEditor } from '../../Channel/create-message-editor';
import { MessageEditorContent } from '../../Channel/InlineMessageEditor';
import { ChannelInput } from '../ChannelInput';
import { makeInputValuePersistenceKey } from '../utils/persistence';

const channelId = 'draft-fixture-channel';

function EditFixture(props: { onSave: (content: string) => void }) {
  const parent = { type: 'channel' as const, id: channelId };
  const message: MessageData = {
    id: 'formatted-message',
    parent,
    content: '~~formatted draft~~',
    sender_id: 'fixture-user',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    attachments: [],
    reactions: [],
  };
  const editor = createMessageEditor({
    parent: () => parent,
    patchMessage: ({ content }) => props.onSave(content),
  });
  editor.start(message);
  return (
    <MessageEditorContent
      parent={parent}
      message={message}
      messageEditor={editor}
      collapsible
    />
  );
}

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
  const [sent, setSent] = createSignal('');
  const [pending, setPending] = createSignal(false);
  let completeSend: (() => void) | undefined;
  let failSend: (() => void) | undefined;
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
                    <output aria-label="Sent message">{sent()}</output>
                    <button
                      type="button"
                      disabled={!pending()}
                      onClick={() => completeSend?.()}
                    >
                      Complete send
                    </button>
                    <button
                      type="button"
                      disabled={!pending()}
                      onClick={() => failSend?.()}
                    >
                      Fail send
                    </button>
                    <Show
                      when={!new URLSearchParams(location.search).has('edit')}
                      fallback={<EditFixture onSave={setSent} />}
                    >
                      <Show when={open()}>
                        <ChannelInput
                          input={{
                            mode: 'channel',
                            id: `channel-input-${channelId}`,
                            placeholder: 'Message #draft-fixture',
                          }}
                          onSend={(snapshot) => {
                            setSent(snapshot.value);
                            setPending(true);
                            return new Promise<void>((resolve, reject) => {
                              completeSend = () => {
                                setPending(false);
                                resolve();
                              };
                              failSend = () => {
                                setPending(false);
                                reject(new Error('offline'));
                              };
                            });
                          }}
                          onSendError={() => {}}
                          participants={() => []}
                          bots={() => []}
                          persistenceKey={makeInputValuePersistenceKey({
                            channelId,
                          })}
                        />
                      </Show>
                    </Show>
                    <ToastRegion />
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
initializeLexical();
render(() => <Fixture />, root);
