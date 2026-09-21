import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { EmailPermissionsBanner } from '@core/component/EmailPermissionsBanner';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';

import { ComposerSurface } from '@ui';

import { createSignal, Show } from 'solid-js';
import { SignaturePreview } from '../components/signature-preview';
import type { EmailComposeContext } from '../context/compose-capabilities';
import { ComposeProvider } from '../context/compose-context';
import type { ComposeContextValue } from '../primitives/compose-view-state';
import {
  createEmailComposer,
  type EmailComposerOptions,
} from '../primitives/email-composer';
import { ComposeLayout } from '../views/compose-layout';
import { EmailComposeToolbar } from '../views/compose-toolbar';
export type EmailComposeViewProps = Pick<
  EmailComposerOptions,
  | 'host'
  | 'draft'
  | 'draftId'
  | 'recipientOptions'
  | 'onRecipientsChange'
  | 'initialTo'
> & { context: EmailComposeContext };
export function EmailComposeView(props: EmailComposeViewProps) {
  const composeContext = props.context;
  const state = createEmailComposer({
    drafts: composeContext.drafts,
    attachmentStorage: composeContext.attachmentStorage,
    delivery: composeContext.delivery,
    draftLifecycle: composeContext.draftLifecycle,
    notices: composeContext.notices,
    accounts: composeContext.accounts,
    connectivity: composeContext.connectivity,
    viewerEmail: composeContext.viewerEmail,
    hasPaidAccess: composeContext.hasPaidAccess,
    recipients: composeContext.recipients,
    recipientName: composeContext.recipientName,
    host: props.host,
    draft: props.draft,
    draftId: props.draftId,
    recipientOptions: props.recipientOptions,
    onRecipientsChange: props.onRecipientsChange,
    initialTo: props.initialTo,
  });
  const {
    editor,
    previewName,
    hasInboxError,
    draftDirty,
    deleteDraftAndReset,
    signature,
    includeSignature,
    setIncludeSignature,
  } = state;
  const ctxValue: ComposeContextValue = {
    ...state.context,
    bodyActions: {
      focusSibling: props.host?.focusSibling,
      recipientAdded: (email) =>
        composeContext.notices.feedback.success(`${email} added to CC`),
      readDroppedFiles: composeContext.editorFiles.readDroppedFiles,
      pasteFiles: (editor, files, directories) =>
        composeContext.editorFiles.uploadEditorFiles({
          editor,
          files,
          directories,
          onUploaded: (ids) =>
            ids.forEach(composeContext.editorFiles.makePublic),
        }),
    },
    isMobile: composeContext.presentation.isMobile,
    scheduleEnabled: composeContext.presentation.scheduleEnabled,
    attachmentFailure: composeContext.notices.feedback.failure,
    onUpgrade: composeContext.presentation.onUpgrade,
    viewerLoading: composeContext.presentation.viewerLoading,
    signaturePreview: () => (
      <Show
        when={
          composeContext.presentation.signaturesEnabled() &&
          includeSignature() &&
          signature()
        }
      >
        {(html) => (
          <SignaturePreview
            mobile={composeContext.presentation.isMobile()}
            prepareLinks={composeContext.presentation.prepareSignatureLinks}
            html={html()}
            dismissable={!state.context.disabled()}
            onDismiss={() => setIncludeSignature(false)}
          />
        )}
      </Show>
    ),
  };
  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);
  const statusLabel = () => ctxValue.deliveryState?.() ?? 'draft';
  const statusTooltip = () => {
    const schedule = ctxValue.schedule.state();
    if (schedule.type === 'scheduled')
      return `Scheduled for ${schedule.confirmedTime.toLocaleString()}. Use the send-time control to propose an update or cancel.`;
    if (statusLabel() === 'sent') return 'This email has been sent.';
    if (statusLabel() === 'missing')
      return 'This draft is no longer available.';
    return 'This is a draft email.';
  };
  const scheduleNotice = () => {
    const schedule = ctxValue.schedule.state();
    if (schedule.type === 'editing') {
      return schedule.intent.type === 'later'
        ? `Will send ${schedule.intent.sendTime.toLocaleString()} after you choose Schedule send.`
        : undefined;
    }
    if (schedule.proposedTime) {
      return `Scheduled for ${schedule.confirmedTime.toLocaleString()}. Proposed replacement: ${schedule.proposedTime.toLocaleString()}. The original remains active until Update schedule succeeds.`;
    }
    return `Scheduled for ${schedule.confirmedTime.toLocaleString()}. Cancel the schedule to edit the message.`;
  };

  if (composeContext.presentation.isMobile()) {
    // Backing out of a compose that has a draft asks whether to keep it.
    props.host?.registerBack?.(() => {
      if (!ctxValue.hasDraft() || !draftDirty()) return false;
      setDraftBackMenuOpen(true);
      return true;
    });
  }

  const leaveCompose = () => {
    setDraftBackMenuOpen(false);
    props.host?.goBack?.();
  };

  return (
    <ComposeProvider value={ctxValue}>
      <Show when={!composeContext.presentation.isMobile()}>
        <SplitHeaderLeft>
          <StaticSplitLabel
            class="ph-no-capture"
            label={ctxValue.subject() || previewName?.() || 'Draft email'}
            iconType="email"
            badges={[
              <SplitHeaderBadge
                text={statusLabel()}
                tooltip={statusTooltip()}
              />,
            ]}
          />
        </SplitHeaderLeft>
      </Show>
      <div class="relative flex flex-col size-full min-h-0 overflow-hidden text-sm">
        {/* No overflow clipping on desktop: the card clips its own content, and
            clipping here would slice the composer shadow flat at the top and
            bottom while the side padding lets it show. */}
        <div class="macro-message-width sm:macro-message-padding mx-auto w-full min-h-120 max-h-full my-2 sm:my-12 touch:my-0 px-2 sm:px-4 touch:px-0 touch:overflow-y-auto touch:scrollbar-hidden touch:min-h-full">
          <WrapUnlessMobile
            wrapper={(children) => (
              // The same card as the chat composer and the thread's message
              // cards, so a fresh draft reads as one of the app's composers.
              <ComposerSurface
                as="div"
                class="relative size-full min-h-0 overflow-clip touch:rounded-xl touch:border touch:border-edge-muted"
              >
                {children}
              </ComposerSurface>
            )}
          >
            <ComposeLayout
              toolbar={<EmailComposeToolbar editor={editor} />}
              notice={
                hasInboxError() ? (
                  <EmailPermissionsBanner />
                ) : scheduleNotice() ? (
                  <div role="status" class="text-sm text-ink-muted">
                    {scheduleNotice()}
                  </div>
                ) : undefined
              }
              class="size-full p-4 touch:bg-surface max-h-full touch:max-h-none overflow-hidden flex flex-col min-h-0 touch:min-h-full"
            />
          </WrapUnlessMobile>
        </div>
      </div>
      <Show when={composeContext.presentation.isMobile()}>
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
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-failure text-center not-last:mb-px"
                  onClick={async () => {
                    // Navigate only once the deletion landed; the mutation
                    // toasts on failure and the composer stays put.
                    try {
                      if (!(await deleteDraftAndReset())) return;
                    } catch {
                      setDraftBackMenuOpen(false);
                      return;
                    }
                    leaveCompose();
                  }}
                >
                  Delete Draft
                </button>
                <button
                  type="button"
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-center"
                  onClick={leaveCompose}
                >
                  Save Draft
                </button>
              </MobileDrawer.Section>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </ComposeProvider>
  );
}
