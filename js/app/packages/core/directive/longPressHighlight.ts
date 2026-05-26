import { type Accessor, onCleanup } from 'solid-js';
import { touchHandler } from './touchHandler';

interface LongPressHighlightOptions {
  onLongPress?: () => void;
  /** CSS class added while the touch highlight is active. Default: `long-press-animation` */
  className?: string;
  /** Delay (ms) before adding the `long-press-animation` class on touch start. If touch ends before this delay, no exit animation plays. Default: 100 */
  enterDelay?: number;
  /** Delay (ms) before removing the `long-press-animation` class after a long press. Default: 50 */
  exitDelay?: number;
  /** Delay (ms) before removing the highlight after a short touch. Default: 0 */
  shortTouchExitDelay?: number;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      longPressHighlight: LongPressHighlightOptions;
    }
  }
}

/**
 * Wraps touchHandler to manage the `long-press-animation` CSS class lifecycle on an element.
 * Pair with the corresponding CSS animation on `.long-press-animation`.
 */
export function longPressHighlight(
  element: HTMLElement,
  options: Accessor<LongPressHighlightOptions>
) {
  let enterTimer: number | undefined;
  let exitTimer: number | undefined;
  let activeClassName: string | undefined;

  const highlightClassName = () =>
    options().className ?? 'long-press-animation';

  const cancelExit = () => {
    if (exitTimer !== undefined) {
      clearTimeout(exitTimer);
      exitTimer = undefined;
    }
  };

  const startAnimation = () => {
    enterTimer = undefined;
    cancelExit();

    const className = highlightClassName();
    if (activeClassName && activeClassName !== className) {
      element.classList.remove(activeClassName);
    }

    activeClassName = className;
    element.classList.add(className);
  };

  const cancelEnter = () => {
    if (enterTimer !== undefined) {
      clearTimeout(enterTimer);
      enterTimer = undefined;
    }
  };

  const endAnimation = () => {
    cancelExit();
    if (activeClassName) {
      element.classList.remove(activeClassName);
      activeClassName = undefined;
      return;
    }
    element.classList.remove(highlightClassName());
  };

  const scheduleEndAnimation = (delay: number) => {
    cancelExit();
    exitTimer = window.setTimeout(endAnimation, delay);
  };

  touchHandler(element, () => ({
    onTouchStart: () => {
      const enterDelay = options().enterDelay ?? 100;
      if (enterDelay === 0) {
        startAnimation();
      } else {
        enterTimer = window.setTimeout(startAnimation, enterDelay);
      }
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
        const exitDelay = options().shortTouchExitDelay ?? 0;
        if (exitDelay === 0) {
          endAnimation();
        } else {
          scheduleEndAnimation(exitDelay);
        }
      } else {
        scheduleEndAnimation(options().exitDelay ?? 50);
      }
    },
  }));

  onCleanup(() => {
    cancelEnter();
    endAnimation();
  });
}
