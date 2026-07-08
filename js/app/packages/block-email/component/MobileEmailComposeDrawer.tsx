import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { createMemo, Show } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { EmailInput } from './EmailInput';

const DEFAULT_DRAWER_SNAP = 0.75;
const EXPANDED_DRAWER_SNAP = 0.92;

function drawerHeightStyle(openPercentage: number) {
  const height = `${Math.round(
    Math.max(
      DEFAULT_DRAWER_SNAP,
      Math.min(EXPANDED_DRAWER_SNAP, openPercentage)
    ) * 100
  )}dvh`;

  return {
    height,
    'max-height': height,
  };
}

export function MobileEmailComposeDrawer(props: {
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}) {
  const context = useEmailContext();

  const replyInfo = createMemo(() => {
    const messageId = context.mobileReplyComposer.messageId();
    if (!messageId || !context.permissions().isOwner) return;

    const replyingTo = context.messages
      .unfiltered()
      .find((message) => message.db_id === messageId);
    if (!replyingTo) return;

    return {
      replyingTo,
      draft: context.drafts.getDraftForMessage(messageId),
    };
  });

  const setDrawerOpen = (open: boolean) => {
    if (open) {
      context.mobileReplyComposer.setOpen(true);
      return;
    }

    context.mobileReplyComposer.close();
    context.messages.setBottomReplyOpen(false);
  };

  return (
    <Show when={replyInfo()}>
      {(info) => (
        <MobileDrawer
          side="bottom"
          open={context.mobileReplyComposer.open()}
          onOpenChange={setDrawerOpen}
          preventScroll={false}
          preventScrollbarShift={false}
          snapPoints={[DEFAULT_DRAWER_SNAP, EXPANDED_DRAWER_SNAP]}
          defaultSnapPoint={DEFAULT_DRAWER_SNAP}
        >
          {(drawer) => (
            <MobileDrawer.Portal>
              <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
              <MobileDrawer.Content
                aria-label="Reply composer"
                class="!h-[100dvh] !max-h-[100dvh] overflow-hidden pb-0"
              >
                <div
                  class="min-h-0 flex flex-col"
                  style={drawerHeightStyle(drawer.openPercentage)}
                >
                  <MobileDrawer.Handle class="pb-1" />
                  <div class="relative min-h-0 flex-1 flex flex-col">
                    <FloatingInputLoader
                      isLoading={context.query.isFetching}
                      loadingText="Loading messages"
                    />
                    <EmailInput
                      replyingTo={() => info().replyingTo}
                      draft={info().draft}
                      setShowReply={(value) => {
                        const next =
                          typeof value === 'function'
                            ? value(context.mobileReplyComposer.open())
                            : value;
                        setDrawerOpen(next);
                        return next;
                      }}
                      markdownDomRef={props.markdownDomRef}
                      unframed
                      mobileDrawer={{
                        onClose: () => setDrawerOpen(false),
                      }}
                    />
                  </div>
                </div>
              </MobileDrawer.Content>
            </MobileDrawer.Portal>
          )}
        </MobileDrawer>
      )}
    </Show>
  );
}
