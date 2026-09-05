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
import {
  createEmailComposer,
  type EmailComposeInput,
} from '../primitives/email-composer';
import { ComposeLayout } from '../views/compose-layout';
import { EmailComposeToolbar } from '../views/compose-toolbar';
import { ComposeProvider } from './compose-context';
export type EmailComposeViewProps = EmailComposeInput;
export function EmailComposeView(props: EmailComposeViewProps) {
  const services = props.services;
  const state = createEmailComposer(props);
  const {
    editor,
    previewName,
    hasLinkError,
    draftDirty,
    deleteDraftAndReset,
    signature,
    includeSignature,
    setIncludeSignature,
  } = state;
  const ctxValue = {
    ...state.context,
    signaturePreview: () => (
      <Show
        when={services.signaturesEnabled() && includeSignature() && signature()}
      >
        {(html) => (
          <SignaturePreview
            mobile={services.isMobile()}
            prepareLinks={services.prepareSignatureLinks}
            html={html()}
            onDismiss={() => setIncludeSignature(false)}
          />
        )}
      </Show>
    ),
  };
  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);

  if (services.isMobile()) {
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
      <Show when={!services.isMobile()}>
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
              notice={hasLinkError() ? <EmailPermissionsBanner /> : undefined}
              class="size-full p-4 bg-surface max-h-full touch:max-h-none overflow-hidden flex flex-col min-h-0 touch:min-h-full"
            />
          </WrapUnlessMobile>
        </div>
      </div>
      <Show when={services.isMobile()}>
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
                      await deleteDraftAndReset();
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
