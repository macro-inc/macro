import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
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
          snapPoints={[0.6, 0.85]}
          defaultSnapPoint={0.6}
          breakPoints={[0.725]}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content
              aria-label="Reply composer"
              class="h-[100dvh] max-h-[100dvh] overflow-hidden"
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
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      )}
    </Show>
  );
}
