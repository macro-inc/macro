import { createBlockSignal } from '@core/block';
import { frameThrottle } from '@core/util/frameThrottle';
import { createEffect } from 'solid-js';

export const windowSizeSignal = createBlockSignal({
  width: 0,
  height: 0,
});

let watcherRegistrations = 0;

export function useUpdateWindowSize() {
  const setWindowSize = windowSizeSignal.set;
  const windowSize = windowSizeSignal.get;
  createEffect(() => {
    if (watcherRegistrations) {
      console.error(
        'Multiple window size watchers registered. Additional watchers on the DOM are redundant. Please check for multiple usages of useUpdateWindowSize()'
      );
    }

    function resizeHandler() {
      setWindowSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    const debouncedResizeHandler = frameThrottle(resizeHandler);

    // Do initial measurement if hook is added post DOMContentLoaded
    if (windowSize().width === 0 && document.readyState === 'complete') {
      debouncedResizeHandler();
    }

    window.addEventListener('resize', debouncedResizeHandler);
    window.addEventListener('DOMContentLoaded', debouncedResizeHandler);
    watcherRegistrations += 1;
    return () => {
      watcherRegistrations -= 1;
      window.removeEventListener('DOMContentLoaded', debouncedResizeHandler);
      window.removeEventListener('resize', debouncedResizeHandler);
    };
  }, [windowSize().width, setWindowSize]);
}
