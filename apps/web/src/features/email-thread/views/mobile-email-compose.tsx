import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { Dialog } from '@ui';
import { createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { ThreadReplyInput } from './thread-reply-input';

export function MobileEmailCompose(props: {
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}) {
  const context = useEmailThreadState();
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>();

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

  const setComposerOpen = (open: boolean) => {
    if (open) {
      context.mobileReplyComposer.setOpen(true);
      return;
    }

    context.mobileReplyComposer.close();
    context.messages.setBottomReplyOpen(false);
  };

  let requestClose = () => setComposerOpen(false);

  return (
    <Show when={replyInfo()}>
      {(info) => (
        <Dialog
          fullscreen
          contentRef={setContentRef}
          open={context.mobileReplyComposer.open()}
          onOpenChange={(open) =>
            open ? setComposerOpen(true) : requestClose()
          }
          onEscapeKeyDown={(event) => {
            if (event.defaultPrevented) return;
            event.preventDefault();
            requestClose();
          }}
          class="flex flex-col overflow-hidden bg-surface text-ink"
        >
          <Dialog.Title class="sr-only">Reply composer</Dialog.Title>
          <div class="relative flex min-h-0 flex-1 flex-col">
            <FloatingInputLoader
              isLoading={context.query.isFetching}
              loadingText="Loading messages"
            />
            <ThreadReplyInput
              replyingTo={() => info().replyingTo}
              draft={info().draft}
              setShowReply={(value) => {
                const next =
                  typeof value === 'function'
                    ? value(context.mobileReplyComposer.open())
                    : value;
                setComposerOpen(next);
                return next;
              }}
              markdownDomRef={props.markdownDomRef}
              unframed
              mobileCompose={{
                portalMount: contentRef,
                onClose: () => setComposerOpen(false),
                registerClose: (handler) => {
                  requestClose = handler;
                  onCleanup(() => {
                    requestClose = () => setComposerOpen(false);
                  });
                },
              }}
            />
          </div>
        </Dialog>
      )}
    </Show>
  );
}
