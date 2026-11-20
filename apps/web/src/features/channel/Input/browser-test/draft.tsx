import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { initializeLexical } from '@core/component/LexicalMarkdown/init';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import type { MessageData } from '@core/messages/types';
import { EntityProvider } from '@entity';
import { staticChannelDirectory } from '@queries/channel/directory';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, Match, onCleanup, Switch } from 'solid-js';
import { render } from 'solid-js/web';
import { createMessageEditor } from '../../Channel/create-message-editor';
import { MessageEditorContent } from '../../Channel/InlineMessageEditor';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { ChannelInput } from '../ChannelInput';
import {
  makeAttachmentTrackerPersistenceKey,
  makeInputValuePersistenceKey,
} from '../utils/persistence';

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
 * The channel as one desktop tab mounts it, `Channel` holding the files and
 * `ChannelInput` the text, over the same stored draft as any other tab.
 */
function ChannelTab(props: {
  label: string;
  autofocus: boolean;
  onSend: (value: string) => void;
}) {
  const attachmentTracker = createInputAttachmentTracker({
    persistenceKey: makeAttachmentTrackerPersistenceKey({ channelId }),
  });
  return (
    <section aria-label={props.label}>
      <ChannelInput
        input={{
          mode: 'channel',
          id: `channel-input-${channelId}`,
          placeholder: 'Message #draft-fixture',
        }}
        autofocus={props.autofocus}
        onSend={(snapshot) => props.onSend(snapshot.value)}
        participants={() => []}
        bots={() => []}
        attachmentTracker={attachmentTracker}
        uploadAttachment={async (file) => ({
          failed: false,
          destination: 'dss',
          type: 'document',
          documentId: `document-${file.name}`,
        })}
        persistenceKey={makeInputValuePersistenceKey({ channelId })}
      />
    </section>
  );
}

/**
 * The real channel composer over the app shell's providers, in the order
 * `routes/Root.tsx` mounts them. Leaving the channel unmounts the composer;
 * opening it again mounts a fresh one over the persisted draft. `?tabs` mounts
 * the channel twice at once, as two desktop tabs on it do.
 */
function Fixture() {
  useHotKeyRoot();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  const search = new URLSearchParams(location.search);
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
              <ChannelDirectoryProvider
                directory={staticChannelDirectory(() => [])}
              >
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
                    <Switch>
                      <Match when={search.has('edit')}>
                        <EditFixture onSave={setSent} />
                      </Match>
                      <Match when={search.has('tabs') && open()}>
                        <ChannelTab
                          label="First tab"
                          autofocus
                          onSend={setSent}
                        />
                        <ChannelTab
                          label="Second tab"
                          autofocus={false}
                          onSend={setSent}
                        />
                      </Match>
                      <Match when={open()}>
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
                          collapsible={search.has('collapsible')}
                          participants={() => []}
                          bots={() => []}
                          persistenceKey={makeInputValuePersistenceKey({
                            channelId,
                          })}
                        />
                      </Match>
                    </Switch>
                    <ToastRegion />
                  </main>
                </QuickAccessProvider>
              </ChannelDirectoryProvider>
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
