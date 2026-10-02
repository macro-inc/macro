import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import type {
  SplitId,
  SplitState,
} from '@components/app/split-layout/layoutManager';
import type { MobileSwipeLayout } from '@components/app/split-layout/mobile/createMobileSwipeLayout';
import { MobileSplitContainer } from '@components/app/split-layout/mobile/MobileSplitContainer';
import { useAndroidBack } from '@core/mobile/androidBack';
import { createSignal, Show } from 'solid-js';
import { createEmailComposer } from '../primitives/email-composer';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';

/** Only the Back role matters here; the container never mounts a panel. */
function stubSwipeLayout(swipeBack: () => void): MobileSwipeLayout {
  return {
    slotASplitId: () => undefined,
    slotBSplitId: () => undefined,
    fgIsSlotA: () => true,
    canGoBack: () => true,
    completeSwipeBack: () => {},
    completeNavigateForward: () => {},
    setAnimatedTrigger: () => {},
    setForwardNavigationTrigger: () => {},
    swipeBack,
  };
}

/** Real composer controller with injected transports, as the draft fixtures use. */
function MobileComposePanel(props: { onLeave: () => void }) {
  const editor = createEmailEditor();
  const state = createEmailComposer({
    drafts: {
      saveDraft: async (input) => ({
        draftId: input.clientHandles?.draftId ?? 'draft',
        threadId: input.clientHandles?.threadId ?? 'thread',
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
        alert: () => undefined,
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
    viewerEmail: () => 'me@example.com',
    hasPaidAccess: () => true,
    recipients: () => [],
    recipientName: (id) => id,
    initialTo: ['colleague@example.com'],
  });
  state.context.captureEditor(editor);
  state.context.onContentChange('');

  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);
  // Mirrors the mobile branch of views/email-compose.tsx.
  useSplitBackInterceptor(() => {
    if (!state.context.hasDraft() || !state.draftDirty()) return false;
    setDraftBackMenuOpen(true);
    return true;
  });

  return (
    <section aria-label="Compose email" class="p-3">
      <p class="text-sm text-ink-muted">To colleague@example.com</p>
      <label class="mt-2 block text-sm">
        Message
        <textarea
          aria-label="Message"
          class="mt-1 block w-full border border-edge-muted bg-transparent p-2 outline-none"
          onInput={(event) => {
            const text = event.currentTarget.value;
            setEmailEditorText(editor, text);
            state.context.onContentChange(text);
          }}
        />
      </label>
      <output class="sr-only" data-testid="draft-dirty">
        {String(state.context.hasDraft() && state.draftDirty())}
      </output>
      <MobileDrawer
        side="bottom"
        open={draftBackMenuOpen()}
        onOpenChange={setDraftBackMenuOpen}
        preventScroll={false}
        preventScrollbarShift={false}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content aria-label="Draft options">
            <MobileDrawer.Handle />
            <MobileDrawer.Section class="mb-3">
              <button
                type="button"
                class="w-full bg-surface px-3 py-3.5 text-center text-sm font-medium text-failure not-last:mb-px"
                onClick={() => {
                  setDraftBackMenuOpen(false);
                  props.onLeave();
                }}
              >
                Delete Draft
              </button>
              <button
                type="button"
                class="w-full bg-surface px-3 py-3.5 text-center text-sm font-medium"
                onClick={() => {
                  setDraftBackMenuOpen(false);
                  props.onLeave();
                }}
              >
                Save Draft
              </button>
            </MobileDrawer.Section>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </section>
  );
}

/**
 * Android's system Back, as `MobilePlugin.kt` dispatches it, driven through the
 * real `useAndroidBack` bridge and the real mobile split container.
 */
export function AndroidBackFixture() {
  const [composerOpen, setComposerOpen] = createSignal(true);
  const [navigatedBack, setNavigatedBack] = createSignal(0);
  useAndroidBack();
  return (
    <main class="min-h-screen bg-surface text-ink">
      <MobileSplitContainer
        splitManager={{ getSplit: () => undefined }}
        mobileSwipeLayout={stubSwipeLayout(() => {
          setNavigatedBack((count) => count + 1);
          setComposerOpen(false);
        })}
        splits={() => [] as ReadonlyArray<SplitState>}
        panelRefs={new Map<SplitId, HTMLDivElement>()}
      />
      <Show
        when={composerOpen()}
        fallback={<p class="p-3 text-sm">Back at the mail list</p>}
      >
        <MobileComposePanel onLeave={() => setComposerOpen(false)} />
      </Show>
      <output class="sr-only" data-testid="navigated-back">
        {navigatedBack()}
      </output>
    </main>
  );
}
