import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { virtualKeyboardHeight } from '@core/mobile/virtualKeyboard';
import { isPlatform } from '@core/util/platform';
import { type Accessor, createMemo, onCleanup, onMount } from 'solid-js';
import { scrollMessageAboveKeyboard } from '../scroll-utils';

type CreateChannelKeyboardHandlerOptions = {
  scrollToLatest: () => void;
  /**
   * Whether the user is near the bottom of the message list. ThreadList
   * re-emits this on viewport resizes, so it stays fresh across keyboard
   * squishes; at keyboardWillShow time it still holds the pre-squish value.
   */
  isNearBottom: Accessor<boolean>;
  /**
   * The message the unified input is currently bound to — the message being
   * edited, or the reply target. Every binding change schedules a one-shot
   * reveal for the next keyboard appearance.
   */
  boundMessageId: Accessor<string | undefined>;
};

/**
 * Channel scroll behavior for virtual-keyboard appearance (native iOS).
 *
 * Both behaviors react to the `keyboardWillShow` event, which is why they
 * live together — a pending target reveal takes precedence over the
 * near-bottom follow so they don't fight over the scroll position:
 * - Target reveal: whenever the unified input binds to a message, a one-shot
 *   scroll is scheduled that brings the bound message above the keyboard and
 *   the floating input riding on it.
 * - Near-bottom follow: when the user was near the bottom of the message
 *   list, scroll back to the bottom so messages are not hidden behind the
 *   keyboard.
 *
 * Listening to the event rather than the keyboard-height signal is what makes
 * measuring safe here: `useAppSquishHandlers` registered its listener first,
 * so the --dvh squish is applied before these handlers run.
 */
export function createChannelKeyboardHandler(
  options: CreateChannelKeyboardHandlerOptions
): void {
  if (!isPlatform('ios')) return;

  // Each binding gets one keyboard reveal. The memo provides identity for a
  // new binding, including unbind/rebind, without an effect mirroring its ID.
  const binding = createMemo(() => ({ messageId: options.boundMessageId() }));
  let revealedBinding: ReturnType<typeof binding> | undefined;

  /**
   * Consume a pending reveal. Returns whether the reveal owned this keyboard
   * appearance (even if the bound message was already fully visible).
   */
  const revealPendingTarget = (): boolean => {
    const current = binding();
    const messageId = current.messageId;
    if (!messageId || current === revealedBinding) return false;
    revealedBinding = current;
    scrollMessageAboveKeyboard(
      messageId,
      virtualKeyboardHeight() + FloatRegions.hostHeight()
    );
    return true;
  };

  onMount(() => {
    const handleKeyboardWillShow = () => {
      // A bound-target reveal owns the scroll for this keyboard appearance.
      if (revealPendingTarget()) return;
      if (options.isNearBottom()) options.scrollToLatest();
    };
    window.addEventListener('keyboardWillShow', handleKeyboardWillShow);
    onCleanup(() => {
      window.removeEventListener('keyboardWillShow', handleKeyboardWillShow);
    });
  });
}
