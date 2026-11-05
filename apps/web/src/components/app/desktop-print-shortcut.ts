import { isDesktopPlatform } from '@core/util/platform';
import { onCleanup } from 'solid-js';

export function useDesktopPrintShortcut(): void {
  if (!isDesktopPlatform()) return;

  let fallbackController: AbortController | undefined;

  const handleKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      // The physical key covers layouts whose P key types another letter.
      (event.key.toLowerCase() !== 'p' && event.code !== 'KeyP')
    )
      return;

    fallbackController?.abort();
    const controller = new AbortController();
    fallbackController = controller;
    const path = event.composedPath();
    const windowTarget = path.at(-1);

    // Install after existing handlers on each node. A stopped event still
    // reaches listeners on that node, so isolated inputs cannot print the shell.
    for (const target of path) {
      const preventNativePrint = (bubblingEvent: Event) => {
        if (bubblingEvent !== event) return;
        // Solid's delegated handlers rewrite currentTarget; use this node.
        if (!event.cancelBubble && target !== windowTarget) return;

        if (!event.defaultPrevented) event.preventDefault();
        controller.abort();
      };
      target.addEventListener('keydown', preventNativePrint, {
        once: true,
        signal: controller.signal,
      });
    }
  };

  window.addEventListener('keydown', handleKeyDown, true);
  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown, true);
    fallbackController?.abort();
  });
}
