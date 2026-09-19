import {
  SwipableRow,
  SwipableRowContext,
} from '@components/app/mobile/SwipableRow';
import { triggerFocusInput } from '@core/directive/focusInput';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ReplyIcon from '@phosphor/arrow-bend-up-left.svg';
import { type ParentProps, Show, useContext } from 'solid-js';
import { getMessageReplyPreviewTexts } from './browser-selection';
import type { MessageActions, MessageData } from './types';

/**
 * The affordance revealed behind a message while it is being swiped. The
 * swipe content is transparent (so thread rails stay visible at rest), so
 * the badge manages its own visibility: hidden until the swipe crosses the
 * activation threshold, fading back out once the swipe triggers.
 */
function SwipeReplyBadge(props: { messageId: string }) {
  const ctx = useContext(SwipableRowContext);
  const revealed = () => ctx?.stateFor(props.messageId)?.phase === 'threshold';

  return (
    <div
      class="size-9 rounded-full bg-accent text-panel flex items-center justify-center transition-opacity duration-150"
      classList={{ 'opacity-0': !revealed() }}
    >
      <ReplyIcon class="size-5" aria-hidden="true" />
    </div>
  );
}

/**
 * On touch devices, wraps a channel message so swiping it left reveals a reply
 * affordance and opens the reply input for its thread. Renders children
 * as-is when there is no surrounding `EntityRowProvider` (desktop,
 * standalone threads) or the message cannot be replied to.
 *
 * Keyed on touch rather than viewport width so tablets get the gesture too —
 * an iPad is wider than the mobile breakpoint but is still finger-driven.
 */
export function MaybeSwipeToReplyRow(
  props: ParentProps<{ message: MessageData; actions?: MessageActions }>
) {
  const ctx = useContext(SwipableRowContext);

  const reply = () => {
    const onReply = props.actions?.onReply;
    if (!onReply) return;
    // Reply inputs are keyed by the thread root, not the swiped message.
    const threadId = props.message.thread_id ?? props.message.id;
    // Called synchronously inside the touch gesture so iOS opens the
    // keyboard once the reply input mounts.
    triggerFocusInput(() =>
      document.querySelector<HTMLElement>(
        `[data-input-id="thread-reply-input-${threadId}"] [contenteditable]`
      )
    );
    void onReply({
      message: props.message,
      ...getMessageReplyPreviewTexts(props.message.id),
    });
  };

  return (
    <Show
      when={isTouchDevice() && ctx && props.actions?.onReply}
      fallback={props.children}
    >
      <SwipableRow
        id={props.message.id}
        class="channel-message-swipe-to-reply-row"
        onSwipeLeft={reply}
        // Transparent throughout: decorations behind the row (thread rails)
        // must stay visible, and the rubber-banded right direction must not
        // tint the row. The badge alone signals the pending action.
        swipeLeftColor="bg-transparent"
        swipeRightColor="bg-transparent"
        rowBgClass="bg-transparent"
        swipeLeftRevealedComponent={
          <SwipeReplyBadge messageId={props.message.id} />
        }
      >
        {props.children}
      </SwipableRow>
    </Show>
  );
}
