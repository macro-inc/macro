import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';

export const hasHaptics = false;

export interface TouchHandlerOptions {
  onLongPress?: JSX.EventHandler<HTMLElement, TouchEvent>;
  onShortTouch?: JSX.EventHandler<HTMLElement, TouchEvent>;
  onCancel?: () => void;
  delay?: number;
  moveThreshold?: number;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      touchHandler: TouchHandlerOptions;
    }
  }
}

/**
 * This signal is used to check if a long press is currently active.
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
  props: Accessor<TouchHandlerOptions>
) {
  if (!props().onLongPress && !props().onShortTouch) {
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

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    startPosition = undefined;
    setLongPressActivated(false);
    props().onCancel?.();
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length > 1) return;
    setValidShortTouch(true);

    const touch = e.touches[0];
    startPosition = { x: touch.clientX, y: touch.clientY };

    timer = window.setTimeout(() => {
      longPressTriggered = true;
      setLongPressActivated(true);
      props().onLongPress?.(
        e as TouchEvent & { currentTarget: HTMLElement; target: Element }
      );
    }, props().delay ?? 500);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!startPosition || e.touches.length > 1) return;

    const touch = e.touches[0];
    const distance = getDistance(touch.clientX, touch.clientY);

    if (distance > (props().moveThreshold ?? 10)) {
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

    if (longPressTriggered) {
      e.stopPropagation();
      longPressTriggered = false;
    } else if (validShortTouch() && !longPressTriggered) {
      if (
        !isAnchorElement &&
        !isButtonElement &&
        !isDocumentMention &&
        !isInternalLink
      ) {
        props().onShortTouch?.(
          e as TouchEvent & { currentTarget: HTMLElement; target: Element }
        );
      }
      setValidShortTouch(false);
      cancel();
    } else {
      cancel();
    }
    setLongPressActivated(false);
  }

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd, { passive: true });
  element.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  onCleanup(() => {
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
    element.removeEventListener('touchend', handleTouchEnd);
    element.removeEventListener('touchcancel', handleTouchEnd);
    cancel();
  });
}
