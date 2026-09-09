import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { FloatingInputLoader } from '@core/component/FloatingInputLoader';
import { createMemo, createSignal, Match, Show, Switch } from 'solid-js';
import { isPersonalMessage } from '../../email-message/core/is-personal-message';
import { EmailMessageView } from '../../email-message/views/email-message';
import { useEmailThreadState } from '../context/email-thread-state-context';
import { useEmailThreadViewContext } from '../context/email-thread-view-context';
import { openEmailReplyComposerForMessage } from '../primitives/reply-actions';
import {
  revealMessageAfterLayout,
  scrollFocusedCardIntoView,
} from '../primitives/scroll-to-message';
import { BottomReplyButtons } from './bottom-reply-buttons';
import { ThreadReplyInput } from './thread-reply-input';

interface MessageContainerProps {
  message: EmailMessage;
  isFirstMessage: boolean;
  isLastMessage: boolean;
  isSelected: boolean;
  allowHover: boolean;
  isExpanded: boolean;
  markdownDomRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
}

export function MessageContainer(props: MessageContainerProps) {
  const { thread: threadContext, rendering } = useEmailThreadViewContext();
  const isTouchDevice = threadContext.isTouch;
  const context = useEmailThreadState();
  const draftChild = createMemo(() => {
    if (!props.message.db_id) return undefined;
    const draft = context.drafts.getDraftForMessage(props.message.db_id);
    if (!draft) return undefined;
    return draft;
  });

  const [showReplyInternal, setShowReplyInternal] =
    createSignal<boolean>(false);

  const showReply = () =>
    showReplyInternal() ||
    context.messages.replyingToMessageId() === props.message.db_id;

  const showInlineReplyInput = createMemo(() => {
    if (isTouchDevice()) return false;
    if (!props.isLastMessage) return showReply() || !!draftChild();
    return context.messages.bottomReplyOpen() || !!draftChild();
  });

  const showDesktopLastReplyControls = createMemo(
    () =>
      props.isLastMessage &&
      !!props.message.db_id &&
      !isTouchDevice() &&
      context.drafts.initialDraftsSettled()
  );

  const showInlineReplyArea = createMemo(
    () =>
      context.permissions().isOwner &&
      (showInlineReplyInput() || showDesktopLastReplyControls())
  );

  const setShowReply = (value: boolean | ((prev: boolean) => boolean)) => {
    const newValue =
      typeof value === 'function' ? value(showReplyInternal()) : value;
    setShowReplyInternal(newValue);
    if (
      !newValue &&
      context.messages.replyingToMessageId() === props.message.db_id
    ) {
      context.messages.setReplyingToMessageId(undefined);
    }
    // Reply/Reply-All/Forward actions on the last message open the bottom
    // reply input (the inline reply only renders for non-last messages).
    if (props.isLastMessage) {
      context.messages.setBottomReplyOpen(newValue);
    }
  };

  // The card selects itself; expanding is the collapsed row's extra behaviour.
  const handleExpand = () => {
    const messageId = props.message.db_id;
    if (!messageId) return;
    context.messages.setExpandedBodyId(messageId, true);
    revealMessageAfterLayout(
      messageId,
      context.messages.list(),
      context.messagesListRef()
    );
  };

  return (
    <EmailMessageView
      message={props.message}
      renderAvatar={rendering.renderAvatar}
      viewerEmail={threadContext.viewerEmail()}
      isTouch={threadContext.isTouch()}
      isPersonal={isPersonalMessage(
        props.message,
        threadContext.viewerEmail(),
        context.messages.personalSenders()
      )}
      showFullContent={props.isFirstMessage}
      isSelected={props.isSelected}
      allowHover={props.allowHover}
      isExpanded={props.isExpanded}
      onExpand={handleExpand}
      onExpandedChange={(expanded) =>
        context.messages.setExpandedBodyId(props.message.db_id, expanded)
      }
      onSelect={() => context.messages.setFocused(props.message.db_id)}
      onHover={() =>
        context.messages.setHovered({
          kind: 'message',
          id: props.message.db_id,
        })
      }
      onUnhover={() => {
        const hovered = context.messages.hovered();
        if (hovered?.kind === 'message' && hovered.id === props.message.db_id)
          context.messages.setHovered(undefined);
      }}
      onFocus={scrollFocusedCardIntoView}
      onOpenAttachment={rendering.openAttachment}
      onReply={
        context.permissions().isOwner
          ? (replyType) =>
              openEmailReplyComposerForMessage({
                ctx: context,
                message: props.message,
                replyType,
                isLastMessage: props.isLastMessage,
                setShowReply,
                isMobile: threadContext.isMobile(),
              })
          : undefined
      }
    >
      <Show when={showInlineReplyArea()}>
        <div class="relative -mx-4 mb-0 border-t border-ink/20 mt-4">
          <Show when={props.isLastMessage && !isTouchDevice()}>
            <FloatingInputLoader
              isLoading={context.query.isFetching}
              loadingText="Loading messages"
            />
          </Show>
          <div class="px-4">
            <Switch>
              <Match when={showInlineReplyInput()}>
                <ThreadReplyInput
                  replyingTo={() => props.message}
                  setShowReply={setShowReply}
                  draft={draftChild()}
                  markdownDomRef={
                    props.isLastMessage ? props.markdownDomRef : undefined
                  }
                  unframed
                />
              </Match>
              <Match when={props.isLastMessage && !isTouchDevice()}>
                <BottomReplyButtons lastMessage={props.message} />
              </Match>
            </Switch>
          </div>
        </div>
      </Show>
    </EmailMessageView>
  );
}
