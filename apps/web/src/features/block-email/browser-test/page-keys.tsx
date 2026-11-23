import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ChannelDirectoryProvider } from '@core/context/channels';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { QuickAccessProvider } from '@core/context/quickAccess/QuickAccessProvider';
import { UserContextProvider } from '@core/context/user';
import { useHotKeyRoot, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { EntityProvider } from '@entity';
import { staticChannelDirectory } from '@queries/channel/directory';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { EmailComposeContext } from '../../email-compose/context/compose-capabilities';
import {
  createThreadContext,
  message,
  thread,
} from '../../email-thread/tests/fixtures';
import { EmailThreadSurface } from '../../email-thread/views/email-thread-surface';
import { registerEmailHotkeys } from '../util/emailHotkeys';

const paragraphs = (label: string) =>
  Array.from(
    { length: 40 },
    (_, index) => `<p>${label}, paragraph ${index + 1} of the update.</p>`
  ).join('');

const THREAD = thread([
  message('first', {
    from: { email: 'ada@example.com', name: 'Ada' },
    body_html_sanitized: paragraphs('First message'),
  }),
  message('second', {
    from: { email: 'grace@example.com', name: 'Grace' },
    body_html_sanitized: paragraphs('Second message'),
  }),
]);

const compose: EmailComposeContext = {
  createRecipientSource: undefined,
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
      alert: () => undefined,
      dismiss: () => {},
    },
    blockingNotice: async () => {},
    confirm: async () => false,
    reportError: () => {},
  },
  accounts: {
    inboxes: () => [
      { id: 'inbox', email_address: 'viewer@example.com', settings: {} },
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
  },
  editorFiles: {
    readDroppedFiles: () => {},
    makePublic: () => {},
    uploadEditorFiles: () => {},
    uploadDocuments: async () => [],
  },
  viewerEmail: () => 'viewer@example.com',
  recipients: () => [],
  recipientName: (id) => id,
  hasPaidAccess: () => true,
  recordMention: () => {},
};

/**
 * The real desktop thread view in a host frame like Mail's
 * (`EmailDetailView`): the keyboard rests on a focusable frame around the
 * thread, outside its message list, and the thread's keys are the shared
 * `registerEmailHotkeys` on the split's scope, over the real hotkey root.
 */
function Thread() {
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('fixture-split');
  const [headerClicks, setHeaderClicks] = createSignal(0);
  let split!: HTMLDivElement;
  let frame: HTMLDivElement | undefined;
  onMount(() => {
    attachHotkeys(split);
    frame?.focus({ preventScroll: true });
  });
  return (
    <div ref={split} class="flex h-[600px] w-[900px] flex-col bg-surface">
      <EmailThreadSurface
        title="Quarterly update"
        threadId={() => 'thread'}
        context={{
          thread: createThreadContext({ thread: () => THREAD }),
          compose,
          rendering: {},
        }}
        emailRendering={{
          theme: () => ({
            inkL: 0.2,
            inkC: 0,
            inkH: 0,
            panelL: 1,
            accentL: 0.5,
            accentC: 0.1,
            accentH: 250,
          }),
          resolveImages: async () => {},
        }}
        host={{
          focusContainer: () => frame?.focus({ preventScroll: true }),
          registerKeyboard: (handlers) =>
            registerEmailHotkeys(scopeId, handlers),
        }}
        header={
          <div class="flex shrink-0 items-center gap-2 p-2">
            <button
              type="button"
              onClick={() => setHeaderClicks((count) => count + 1)}
            >
              Header action
            </button>
            <output data-testid="header-clicks">{headerClicks()}</output>
            <input aria-label="Header field" class="border" />
          </div>
        }
        frame={(content) => (
          <div
            ref={frame}
            data-testid="thread-frame"
            class="relative min-h-0 min-w-0 flex-1"
            tabIndex={-1}
          >
            {content()}
          </div>
        )}
      />
    </div>
  );
}

/** Providers in the order `routes/Root.tsx` mounts them. */
function Fixture() {
  useHotKeyRoot();
  return (
    <QueryClientProvider client={new QueryClient()}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <EntityProvider>
            <UserContextProvider>
              <EmailLinksContextProvider>
                <ChannelDirectoryProvider
                  directory={staticChannelDirectory(() => [])}
                >
                  <QuickAccessProvider>
                    <main class="min-h-screen bg-surface p-4 text-ink">
                      <Thread />
                    </main>
                  </QuickAccessProvider>
                </ChannelDirectoryProvider>
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
