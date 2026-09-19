import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { EmailPermissionsBanner } from '@core/component/EmailPermissionsBanner';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';

import { Surface } from '@ui';

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
    notices: composeContext.notices,
    accounts: composeContext.accounts,
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
            onDismiss={() => setIncludeSignature(false)}
          />
        )}
      </Show>
    ),
  };
  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);

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
              <SplitHeaderBadge text="draft" tooltip="This is a Draft Email" />,
            ]}
          />
        </SplitHeaderLeft>
      </Show>
      <div class="relative flex flex-col size-full min-h-0 overflow-hidden text-sm">
        <div class="macro-message-width sm:macro-message-padding mx-auto w-full min-h-120 max-h-full my-2 sm:my-12 touch:my-0 px-2 sm:px-4 touch:px-0 overflow-hidden touch:overflow-y-auto touch:scrollbar-hidden touch:min-h-full">
          <WrapUnlessMobile
            wrapper={(children) => (
              <Surface depth={2} class="rounded-xl border border-ink-muted/8">
                {children}
              </Surface>
            )}
          >
            <ComposeLayout
              toolbar={<EmailComposeToolbar editor={editor} />}
              notice={hasInboxError() ? <EmailPermissionsBanner /> : undefined}
              class="size-full p-4 bg-surface max-h-full touch:max-h-none overflow-hidden flex flex-col min-h-0 touch:min-h-full"
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
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
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
