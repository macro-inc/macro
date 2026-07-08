import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@app/component/mobile/MobileDrawer';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { createMemo, Show } from 'solid-js';
import { useEmailContext } from './EmailContext';
import { EmailInput } from './EmailInput';

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
          breakPoints={[0.85]}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content aria-label="Reply composer" maxHeight={90} targetHeight={90}>
              <MobileDrawer.Handle class="pb-1" />

              <div class="relative flex-1 min-h-0">
                <FloatingInputLoader
                  isLoading={context.query.isFetching}
                  loadingText="Loading messages"
                />
                <div
                  class="overflow-y-auto scrollbar-hidden h-full pb-1"
                  onFocusIn={(e) => scrollToFocusedInput(e)}
                >
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
        </MobileDrawer>
      )}
    </Show>
  );
}
