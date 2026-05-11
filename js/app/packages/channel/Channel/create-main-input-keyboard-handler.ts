import { isPlatform } from '@core/util/platform';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { NEAR_BOTTOM_THRESHOLD } from './constants';
import type { ThreadListNavigation } from './ThreadList';

/**
 * On native ios app, when the main channel input is focused and the user was near the
 * bottom of the message list, scrolls to the bottom after the virtual keyboard
 * appears (so messages aren't hidden behind the keyboard).
 */
export function createMainInputKeyboardHandler(
  inputContainerEl: Accessor<HTMLElement | undefined>,
  navigation: Accessor<ThreadListNavigation | undefined>,
  channelRoot: Accessor<HTMLElement | undefined>
): void {
  if (!isPlatform('ios')) return;

  // Read from the DOM directly: the scrollState signal is only updated on scroll
  // events, which can fire after the keyboard has already shrunk the viewport,
  // leaving a stale isNearBottom=false that persists until the next user scroll.
  let wasNearBottom = false;

  const captureNearBottom = () => {
    const root = channelRoot();
    const scrollEl = root?.querySelector<HTMLElement>('[data-channel-scroll]');
    if (!scrollEl) {
      wasNearBottom = false;
      return;
    }
    const distanceFromBottom =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    wasNearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  };

  createEffect(() => {
    const el = inputContainerEl();
    if (!el) return;

    const handleTouchStart = () => captureNearBottom();
    el.addEventListener('touchstart', handleTouchStart, {
      capture: true,
      passive: true,
    });

    const handleKeyboardWillShow = () => {
      if (!el.contains(document.activeElement)) return;
      if (wasNearBottom) navigation()?.scrollToBottom();
    };
    window.addEventListener('keyboardWillShow', handleKeyboardWillShow);
    onCleanup(() => {
      el.removeEventListener('touchstart', handleTouchStart, {
        capture: true,
      });
      window.removeEventListener('keyboardWillShow', handleKeyboardWillShow);
    });
  });
}
