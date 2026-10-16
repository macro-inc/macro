import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelsContextProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import {
  registerHotkey,
  useHotKeyRoot,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { message } from '../../email-message/tests/messages';
import type { EmailComposeContext } from '../context/compose-capabilities';
import { ComposeProvider } from '../context/compose-context';
import { EmailFormContextProvider } from '../context/email-form-context';
import type { ReplyType } from '../core/reply-type';
import { createEmailComposer } from '../primitives/email-composer';
import { ComposeLayout } from '../views/compose-layout';
import { ReplyInputView } from '../views/reply-input';

const context: EmailComposeContext = {
  drafts: {
    saveDraft: async () => ({
      draftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
    }),
    deleteDraft: async () => {},
    restoreDraft: async () => {},
  },
  attachmentStorage: {
    uploadAttachments: async () => {},
    addForwardedAttachments: async () => {},
    removeAttachment: async () => {},
    removeForwardedAttachment: async () => {},
  },
  delivery: {
    sendMessage: async () => ({ inboxId: 'inbox' }),
    unschedule: async () => {},
    schedule: async () => {},
    archive: async () => {},
    undoSend: async () => {},
  },
  draftLifecycle: {
    observe: () => ({
      state: () => undefined,
      refresh: async () => undefined,
    }),
  },
  notices: {
    feedback: {
      success: () => undefined,
      failure: () => undefined,
      alert: () => {},
      dismiss: () => {},
    },
    blockingNotice: async () => {},
    reportError: () => {},
  },
  accounts: {
    inboxes: () => [
      { id: 'inbox', email_address: 'me@example.com', settings: {} },
    ],
    loading: () => false,
    failed: () => false,
    primaryId: () => 'inbox',
  },
  connectivity: { looksOffline: () => false },
  presentation: {
    viewerLoading: () => false,
    onUpgrade: () => {},
    prepareSignatureLinks: () => {},
    isTouch: () => false,
    isMobile: () => false,
    scheduleEnabled: false,
    signaturesEnabled: () => false,
  },
  editorFiles: {
    readDroppedFiles: () => {},
    makePublic: () => {},
    uploadEditorFiles: () => {},
  },
  viewerEmail: () => 'me@example.com',
  recipients: () => [],
  recipientName: (id) => id,
  hasPaidAccess: () => true,
  recordMention: () => {},
};

/**
 * Production composers sit inside a split whose entity commands bind the same
 * keys (Copy link, Copy branch name), so the composer has to claim them first.
 */
function ThreadScope(props: { children: JSX.Element }) {
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('fixture-thread');
  const [threadCommand, setThreadCommand] = createSignal('none');
  registerHotkey({
    hotkey: 'shift+cmd+c',
    scopeId,
    description: 'Copy link',
    keyDownHandler: () => {
      setThreadCommand('Copy link');
      return true;
    },
    runWithInputFocused: true,
  });
  registerHotkey({
    hotkey: 'shift+cmd+b',
    scopeId,
    description: 'Copy branch name',
    keyDownHandler: () => {
      setThreadCommand('Copy branch name');
      return true;
    },
    runWithInputFocused: true,
  });
  let element!: HTMLDivElement;
  onMount(() => attachHotkeys(element));
  return (
    <div ref={element}>
      {props.children}
      <output data-testid="thread-command">{threadCommand()}</output>
    </div>
  );
}

function NewEmail() {
  const state = createEmailComposer({
    ...context,
    initialTo: ['colleague@example.com'],
  });
  return (
    <ComposeProvider
      value={{
        ...state.context,
        bodyActions: {
          recipientAdded: () => {},
          readDroppedFiles: () => {},
          insertFiles: () => {},
        },
        isMobile: () => false,
        scheduleEnabled: false,
        attachmentFailure: () => {},
      }}
    >
      <ComposeLayout />
    </ComposeProvider>
  );
}

function Reply(props: { replyType: ReplyType }) {
  const parent = message('parent', {
    from: { email: 'sender@example.com' },
    to: [{ email: 'me@example.com' }, { email: 'teammate@example.com' }],
  });
  const [requestedType, setRequestedType] = createSignal<ReplyType | undefined>(
    props.replyType
  );
  return (
    <EmailFormContextProvider
      context={{
        viewerEmail: context.viewerEmail,
        inboxes: context.accounts.inboxes,
      }}
      formOptions={{
        getMessageById: () => parent,
        getDraftForMessageReply: () => undefined,
      }}
    >
      <ReplyInputView
        context={context}
        sourceEntityId="thread"
        replyingTo={() => parent}
        session={{
          thread: () => ({
            db_id: 'thread',
            link_id: 'inbox',
            inbox_visible: true,
          }),
          recipientOptions: () => [],
          isPersonalReply: () => false,
          onDraftRemoved: () => {},
          exitToThread: () => false,
          replyRequest: {
            replyType: requestedType,
            clear: () => setRequestedType(undefined),
          },
        }}
      />
    </EmailFormContextProvider>
  );
}

const replyTypes: ReplyType[] = ['reply', 'reply-all', 'forward'];

/**
 * The real new-email layout and reply input, driven by the real hotkey root.
 * The editor menus and recipient fields read the app shell's providers, in
 * the order `routes/Root.tsx` mounts them.
 */
function Fixture() {
  useHotKeyRoot();
  const composer = new URLSearchParams(location.search).get('composer');
  const replyType = replyTypes.find((type) => type === composer);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelsContextProvider>
                  <QuickAccessProvider>
                    <main class="min-h-screen bg-surface p-4 text-ink">
                      <ThreadScope>
                        <Show when={replyType} fallback={<NewEmail />}>
                          {(type) => <Reply replyType={type()} />}
                        </Show>
                      </ThreadScope>
                    </main>
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
