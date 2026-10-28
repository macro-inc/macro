import { type Accessor, createEffect, on, onCleanup } from 'solid-js';

/** Focuses a split shell once it attaches, without taking existing focus. */
export function createSplitAutofocus(options: {
  element: Accessor<HTMLElement | null>;
  enabled: Accessor<boolean>;
}) {
  createEffect(
    on(options.element, (element) => {
      if (!element || !options.enabled()) return;

      let disposed = false;
      let observer: MutationObserver | undefined;
      onCleanup(() => {
        disposed = true;
        observer?.disconnect();
      });

      const focusWhenAttached = () => {
        if (disposed) return;
        if (!options.enabled()) {
          observer?.disconnect();
          return;
        }
        if (!element.isConnected) return;

        observer?.disconnect();
        const active = document.activeElement;
        if (
          active &&
          active !== document.body &&
          active !== document.documentElement
        ) {
          return;
        }

        element.focus({ preventScroll: true });
      };

      // Inner Suspense boundaries can finish mounting before an outer boundary attaches this shell. Wait for attachment. Defer the focus event so hotkey scope writes run outside this effect.
      queueMicrotask(() => {
        if (disposed) return;
        if (!element.isConnected) {
          observer = new MutationObserver(focusWhenAttached);
          observer.observe(document.body, { childList: true, subtree: true });
        }
        focusWhenAttached();
      });
    })
  );
}
