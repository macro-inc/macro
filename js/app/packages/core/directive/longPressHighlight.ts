import { type Accessor, onCleanup } from 'solid-js';
import { touchHandler } from './touchHandler';

const LONG_PRESS_ENTER_DELAY_MS = 100;
const LONG_PRESS_EXIT_DELAY_MS = 50;

interface LongPressHighlightOptions {
  onLongPress?: () => void;
  /** CSS class added while the touch highlight is active. */
  className: string;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      longPressHighlight: LongPressHighlightOptions;
    }
  }
}

/**
 * Wraps touchHandler to manage a touch highlight CSS class lifecycle on an element.
 * Pair with a corresponding CSS animation for the configured className.
 */
export function longPressHighlight(
  element: HTMLElement,
  options: Accessor<LongPressHighlightOptions>
) {
  let enterTimer: number | undefined;
  let exitTimer: number | undefined;
  let activeClassName: string | undefined;

  const highlightClassName = () => options().className;

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
      enterTimer = window.setTimeout(startAnimation, LONG_PRESS_ENTER_DELAY_MS);
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
        scheduleEndAnimation(LONG_PRESS_EXIT_DELAY_MS);
      }
    },
  }));

  onCleanup(() => {
    cancelEnter();
    endAnimation();
  });
}
