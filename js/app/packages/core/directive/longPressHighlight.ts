import { type Accessor, onCleanup } from 'solid-js';
import { touchHandler } from './touchHandler';

export interface LongPressHighlightOptions {
  onLongPress?: () => void;
  /** Delay (ms) before adding the longPress class on touch start. If touch ends before this delay, no exit animation plays. Default: 50 */
  enterDelay?: number;
  /** Delay (ms) before exiting animation after a long press. Default: 50 */
  exitDelay?: number;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      longPressHighlight: LongPressHighlightOptions;
    }
  }
}

/**
 * Wraps touchHandler to manage the longPress/longPressExit CSS class lifecycle on an element.
 * Pair with the corresponding CSS animations on .longPress and .longPressExit.
 */
export function longPressHighlight(
  element: HTMLElement,
  options: Accessor<LongPressHighlightOptions>
) {
  let enterTimer: number | undefined;

  const startAnimation = () => {
    enterTimer = undefined;
    element.classList.add('long-press-animation');
  };

  const cancelEnter = () => {
    if (enterTimer !== undefined) {
      clearTimeout(enterTimer);
      enterTimer = undefined;
    }
  };

  const endAnimation = () => {
    element.classList.remove('long-press-animation');
  };

  touchHandler(element, () => ({
    onTouchStart: () => {
      enterTimer = window.setTimeout(
        startAnimation,
        options().enterDelay ?? 100
      );
    },
    onLongPress: () => {
      options().onLongPress?.();
    },
    onCancel: () => {
      cancelEnter();
      endAnimation();
    },
    onTouchEnd: (_e, longpress) => {
      cancelEnter();
      if (!longpress) {
        endAnimation();
      } else {
        setTimeout(endAnimation, options().exitDelay ?? 50);
      }
    },
  }));

  onCleanup(cancelEnter);
}
