import { impactFeedback } from '@tauri-apps/plugin-haptics';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';

export const hasHaptics = false;

export interface TouchHandlerOptions {
  onLongPress?: JSX.EventHandler<HTMLElement, TouchEvent>;
  onShortTouch?: JSX.EventHandler<HTMLElement, TouchEvent>;
  onCancel?: () => void;
  delay?: number;
  moveThreshold?: number;
  stopTouchStartPropagation?: boolean;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      touchHandler: TouchHandlerOptions;
    }
  }
}

/**
 * This global signal can be used to check if a long press is currently active.
 * For example, it is used to prevent the clickOutside directive from triggering when a long press is active.
 */
export const [longPressActivated, setLongPressActivated] = createSignal(false);

/**
 * This directive can be used to trigger callbacks on long press and short touch events.
 * Long press is triggered when the user holds the touch for a certain amount of time (default 500ms), without moving the touch more than a certain distance (default 10px).
 * Short touch is triggered when the user ends their touch, if they didn't move the touch more than a certain distance (default 10px).
 */
export function touchHandler(
  element: HTMLElement,
  options: Accessor<TouchHandlerOptions>
) {
  if (!options().onLongPress && !options().onShortTouch) {
    return;
  }

  let timer: number;
  let startPosition: { x: number; y: number } | undefined;
  let longPressTriggered = false;
  const [validShortTouch, setValidShortTouch] = createSignal(true);

  function getDistance(x: number, y: number) {
    if (!startPosition) return 0;
    const deltaX = Math.abs(x - startPosition.x);
    const deltaY = Math.abs(y - startPosition.y);
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  function resetState() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    startPosition = undefined;
    longPressTriggered = false;
    setValidShortTouch(true);
    setLongPressActivated(false);
  }

  function cancel() {
    resetState();
    options().onCancel?.();
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length > 1) {
      setValidShortTouch(false);
      return;
    }
    setValidShortTouch(true);

    const touch = e.touches[0];
    startPosition = { x: touch.clientX, y: touch.clientY };

    if (options().stopTouchStartPropagation) {
      e.stopPropagation();
    }

    timer = window.setTimeout(() => {
      longPressTriggered = true;
      setLongPressActivated(true);
      void impactFeedback('medium');
      options().onLongPress?.(
        e as TouchEvent & { currentTarget: HTMLElement; target: Element }
      );
    }, options().delay ?? 500);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!startPosition || e.touches.length > 1) return;

    const touch = e.touches[0];
    const distance = getDistance(touch.clientX, touch.clientY);

    if (distance > (options().moveThreshold ?? 10)) {
      setValidShortTouch(false);
      cancel();
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    const isAnchorElement = (e.target as Element)?.closest('a');
    const isButtonElement = (e.target as Element)?.closest('button');
    const isDocumentMention = (e.target as Element)?.closest(
      '[document-mention]'
    );
    const isInternalLink = (e.target as Element)?.closest('[internal-link]');

    const touchedSomethingSharp =
      isAnchorElement || isButtonElement || isDocumentMention || isInternalLink;

    if (longPressTriggered) {
      e.stopPropagation();
      e.preventDefault();
    } else if (validShortTouch() && !touchedSomethingSharp) {
      options().onShortTouch?.(
        e as TouchEvent & { currentTarget: HTMLElement; target: Element }
      );
    }
    resetState();
  }

  function handleTouchCancel() {
    resetState();
    options().onCancel?.();
  }

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd);
  element.addEventListener('touchcancel', handleTouchCancel, { passive: true });

  onCleanup(() => {
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
    element.removeEventListener('touchend', handleTouchEnd);
    element.removeEventListener('touchcancel', handleTouchCancel);
    cancel();
  });
}
