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
import type { readContactDirectory } from '@queries/contacts/directory';
import { createContactRecipientSource } from '@queries/contacts/recipient-window';
import {
  hashKey,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/solid-query';
import { createSignal, type JSX, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { message } from '../../email-message/tests/messages';
import type { EmailComposeContext } from '../context/compose-capabilities';
import { ComposeProvider } from '../context/compose-context';
import { EmailFormContextProvider } from '../context/email-form-context';
import { convertContactInfoToEmailRecipient } from '../core/recipient-conversion';
import type { ReplyType } from '../core/reply-type';
import { createEmailComposer } from '../primitives/email-composer';
import { ComposeLayout } from '../views/compose-layout';
import { ReplyInputView } from '../views/reply-input';

/** Free plans add the "Sent with Macro" watermark below the message. */
const freePlan = new URLSearchParams(location.search).has('free');
const directoryEnabled = new URLSearchParams(location.search).has('directory');
const mobile = new URLSearchParams(location.search).has('mobile');
const [directoryReads, setDirectoryReads] = createSignal(0);
const [directoryRows, setDirectoryRows] = createSignal(0);
const scopedRecipients = () =>
  directoryEnabled
    ? [
        convertContactInfoToEmailRecipient({
          email: 'sender@example.com',
          name: 'Thread sender',
        }),
      ]
    : [];
const readDirectory: typeof readContactDirectory = async (
  viewer,
  _host,
  request
) => {
  setDirectoryReads((count) => count + 1);
  const offset =
    request.cursor?.source === 'people' ? Number(request.cursor.after) : 0;
  const ids =
    request.query === 'late'
      ? [99_999]
      : request.query.includes('sender')
        ? [-1]
        : request.query
          ? []
          : Array.from(
              { length: Math.min(50, 100_000 - offset) },
              (_, i) => offset + i
            );
  setDirectoryRows(ids.length);
  return {
    source: 'cache',
    sync: 'partial',
    offline: false,
    query: request.query,
    users: ids.map((id) =>
      id === -1
        ? {
            id: 'macro|sender@example.com',
            email: 'sender@example.com',
            name: 'Directory sender',
          }
        : {
            id: `macro|person${id}@example.com`,
            email: `person${id}@example.com`,
            name: id === 99_999 ? 'Late Person' : `Person ${id}`,
          }
    ),
    nextCursor:
      !request.query && offset + ids.length < 100_000
        ? {
            source: 'people',
            generation: 'fixture',
            after: String(offset + ids.length),
            userId: viewer,
            query: request.query,
            policyKey: hashKey([request.policy]),
          }
        : null,
  };
};

const context: EmailComposeContext = {
  createRecipientSource: directoryEnabled
    ? (input) =>
        createContactRecipientSource(
          () => ({ userId: 'macro|me@example.com' }),
          input,
          () => false,
          readDirectory
        )
    : undefined,
  drafts: {
    saveDraft: async () => ({
      draftId: 'draft',
      threadId: 'thread',
      inboxId: 'inbox',
    }),
    transferDraft: async () => ({
      draftId: 'transferred-draft',
      threadId: 'transferred-thread',
      attachments: [],
    }),
    deleteDraft: async () => {},
    restoreDraft: async () => {},
  },
  attachmentStorage: {
    uploadAttachments: async () => {},
    completeAttachment: async () => {},
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
    confirm: async () => false,
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
    isTouch: () => mobile,
    isMobile: () => mobile,
    scheduleEnabled: false,
    signaturesEnabled: () => false,
  },
  editorFiles: {
    readDroppedFiles: () => {},
    makePublic: () => {},
    uploadEditorFiles: () => {},
    uploadDocuments: async () => [],
  },
  viewerEmail: () => 'me@example.com',
  recipients: () => [],
  recipientName: (id) => id,
  hasPaidAccess: () => !freePlan,
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
    initialTo: directoryEnabled ? [] : ['colleague@example.com'],
    recipientOptions: scopedRecipients,
  });
  return (
    <ComposeProvider
      value={{
        ...state.context,
        createRecipientSource: context.createRecipientSource,
        bodyActions: {
          recipientAdded: () => {},
          readDroppedFiles: () => {},
          insertFiles: () => {},
        },
        isMobile: () => mobile,
        scheduleEnabled: false,
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
          recipientOptions: scopedRecipients,
          ownsThreadInbox: () => true,
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
                      <output data-testid="directory-reads">
                        {directoryReads()}
                      </output>
                      <output data-testid="directory-rows">
                        {directoryRows()}
                      </output>
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
