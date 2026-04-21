import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isPlatform } from '@core/util/platform';
import { isIOS } from '@solid-primitives/platform';
import { type Accessor, onCleanup } from 'solid-js';

export type FocusInputOptions = {
  getTarget: () => HTMLElement | null | undefined;
  positionNear?: HTMLElement;
};

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      focusInput: FocusInputOptions;
    }
  }
}

/**
 * Focuses a target input when the host element is clicked.
 *
 * Pass a callback to the target element — it need not exist in the DOM at click
 * time. If the element is already visible, it is focused immediately. Otherwise
 * a MutationObserver waits for it to appear and focuses it once visible.
 *
 * The reason for this function to exist is that on iOS we have to perform a
 * disgusting workaround to accomplish this behavior. The virtual keyboard is
 * only allowed to appear synchronously, in response to user interaction. So,
 * if the target input does not currently exist, we have to create a temporary
 * input to focus immediately, then transfer focus to the real target once it
 * appears in the DOM.
 */
export function focusInput(
  el: HTMLElement,
  options: Accessor<FocusInputOptions>
) {
  const { getTarget, positionNear } = options();
  const anchor = positionNear ?? el;

  const handleClick = () => {
    const target = getTarget();
    if (target && isVisible(target)) {
      target.focus();
      return;
    }

    let observer: MutationObserver | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let tempEl: HTMLInputElement | undefined;

    function cleanup() {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (tempEl && document.body.contains(tempEl))
        document.body.removeChild(tempEl);
      observer?.disconnect();
      window.removeEventListener('beforeunload', cleanup);
    }

    function handleAppearance(target: HTMLElement) {
      setTimeout(() => {
        target.focus();
        cleanup();
      }, 0);
    }

    if ((isTouchDevice() && isIOS) || isPlatform('ios')) {
      // iOS only: focus a hidden temporary input synchronously within the
      // click gesture so the virtual keyboard opens, then transfer focus to
      // the real target once it appears in the DOM.
      tempEl = document.createElement('input');
      tempEl.style.position = 'absolute';
      tempEl.style.top = `${(anchor.offsetTop ?? 0) + 7}px`;
      tempEl.style.left = `${anchor.offsetLeft ?? 0}px`;
      tempEl.style.height = '0';
      tempEl.style.opacity = '0';
      tempEl.style.fontSize = '16px';
      document.body.appendChild(tempEl);
      tempEl.focus();
    }

    observer = new MutationObserver(() => {
      const current = getTarget();
      if (current && isVisible(current)) handleAppearance(current);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    timeoutId = setTimeout(cleanup, 5000);
    window.addEventListener('beforeunload', cleanup, { once: true });
  };

  el.addEventListener('click', handleClick);
  onCleanup(() => el.removeEventListener('click', handleClick));
}

function isVisible(el: HTMLElement): boolean {
  // offsetParent is null for hidden elements, but also for position:fixed elements
  // and their descendants — fall back to bounding rect in that case.
  if (el.offsetParent !== null) return true;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}
