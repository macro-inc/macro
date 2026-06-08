import { hapticImpact } from '@core/mobile/haptics';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

const TOUCH_CLASS_ENTER_DELAY_MS = 100;
const TOUCH_CLASS_EXIT_DELAY_MS = 50;

interface TouchHandlerOptions {
  onLongPress?: (e: TouchEvent) => void;
  onTouchStart?: (e: TouchEvent) => void;
  onShortTouch?: (e: TouchEvent) => void;
  onCancel?: () => void;
  onTouchEnd?: (e: TouchEvent, longPressTriggered: boolean) => void;
  delay?: number;
  moveThreshold?: number;
  stopTouchStartPropagation?: boolean;
  /** CSS class added while the touch highlight is active. */
  touchClassName?: string;
  touchClassEnterDelay?: number;
  touchClassExitDelay?: number;
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
  if (!isTouchDevice()) {
    return;
  }

  let timer: number;
  let touchClassEnterTimer: number | undefined;
  let touchClassExitTimer: number | undefined;
  let activeTouchClassName: string | undefined;
  let startPosition: { x: number; y: number } | undefined;
  let longPressTriggered = false;
  const [validShortTouch, setValidShortTouch] = createSignal(true);

  const touchClassName = () => options().touchClassName;

  function cancelTouchClassExit() {
    if (touchClassExitTimer !== undefined) {
      clearTimeout(touchClassExitTimer);
      touchClassExitTimer = undefined;
    }
  }

  function startTouchClass() {
    touchClassEnterTimer = undefined;
    cancelTouchClassExit();

    const className = touchClassName();
    if (!className) return;

    if (activeTouchClassName && activeTouchClassName !== className) {
      element.classList.remove(activeTouchClassName);
    }

    activeTouchClassName = className;
    element.classList.add(className);
  }

  function cancelTouchClassEnter() {
    if (touchClassEnterTimer !== undefined) {
      clearTimeout(touchClassEnterTimer);
      touchClassEnterTimer = undefined;
    }
  }

  function endTouchClass() {
    cancelTouchClassExit();
    if (activeTouchClassName) {
      element.classList.remove(activeTouchClassName);
      activeTouchClassName = undefined;
      return;
    }

    const className = touchClassName();
    if (className) {
      element.classList.remove(className);
    }
  }

  function scheduleTouchClassEnd(delay: number) {
    cancelTouchClassExit();
    touchClassExitTimer = window.setTimeout(endTouchClass, delay);
  }

  function getDistance(x: number, y: number) {
    if (!startPosition) return 0;
    const deltaX = Math.abs(x - startPosition.x);
    const deltaY = Math.abs(y - startPosition.y);
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  }

  function clearState() {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
    }
    startPosition = undefined;
    longPressTriggered = false;
    setLongPressActivated(false);
  }

  function initStateForNewTouch() {
    clearState();
    setValidShortTouch(true);
  }

  function handleTouchCancel() {
    clearState();
    cancelTouchClassEnter();
    endTouchClass();
    options().onCancel?.();
  }

  function handleTouchStart(e: TouchEvent) {
    if (e.touches.length > 1) {
      clearState();
      cancelTouchClassEnter();
      endTouchClass();
      setValidShortTouch(false);
      return;
    }
    initStateForNewTouch();

    const touch = e.touches[0];
    startPosition = { x: touch.clientX, y: touch.clientY };

    if (options().stopTouchStartPropagation) {
      e.stopPropagation();
    }

    options().onTouchStart?.(e);
    if (touchClassName()) {
      touchClassEnterTimer = window.setTimeout(
        startTouchClass,
        options().touchClassEnterDelay ?? TOUCH_CLASS_ENTER_DELAY_MS
      );
    }
    timer = window.setTimeout(() => {
      longPressTriggered = true;
      setLongPressActivated(true);
      hapticImpact('medium');
      options().onLongPress?.(e);
    }, options().delay ?? 500);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!startPosition || e.touches.length > 1) return;

    const touch = e.touches[0];
    const distance = getDistance(touch.clientX, touch.clientY);

    if (distance > (options().moveThreshold ?? 10)) {
      setValidShortTouch(false);
      handleTouchCancel();
    }
  }

  function handleTouchEnd(e: TouchEvent) {
    const wasLongPressTriggered = longPressTriggered;

    options().onTouchEnd?.(e, wasLongPressTriggered);
    cancelTouchClassEnter();
    if (!wasLongPressTriggered) {
      endTouchClass();
    } else {
      scheduleTouchClassEnd(
        options().touchClassExitDelay ?? TOUCH_CLASS_EXIT_DELAY_MS
      );
    }

    const isAnchorElement = (e.target as Element)?.closest('a');
    const isButtonElement = (e.target as Element)?.closest('button');
    const isDocumentMention = (e.target as Element)?.closest(
      '[document-mention]'
    );
    const isInternalLink = (e.target as Element)?.closest('[internal-link]');

    const touchedSomethingSharp =
      isAnchorElement || isButtonElement || isDocumentMention || isInternalLink;

    if (wasLongPressTriggered) {
      e.stopPropagation();
      e.preventDefault();
    } else if (validShortTouch() && !touchedSomethingSharp) {
      options().onShortTouch?.(e);
    }
    clearState();
  }

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd);
  element.addEventListener('touchcancel', handleTouchCancel, { passive: true });

  onCleanup(() => {
    cancelTouchClassEnter();
    endTouchClass();
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
    element.removeEventListener('touchend', handleTouchEnd);
    element.removeEventListener('touchcancel', handleTouchCancel);
  });
}
