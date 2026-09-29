import { isPlatform } from '@core/util/platform';
import { onCleanup, onMount } from 'solid-js';

declare global {
  interface WindowEventMap {
    'android-back': Event;
    'android-navigate-back': Event;
  }
}

/** Use the same Escape handlers as touch sheets, menus and editor popups. */
export function dismissAndroidBackOverlay(): boolean {
  const overlay = [
    ...document.querySelectorAll(
      '[data-kb-top-layer], [data-corvu-dialog-content][data-open], [data-corvu-drawer-content][data-open]'
    ),
  ].find((element) => {
    // Always-mounted toast regions also carry Kobalte's top-layer marker.
    if (element.matches('[role="region"], [role="tooltip"]')) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(escapeEvent);
  // A non-dismissible/pending dialog also owns Back: do not navigate underneath it.
  return !!overlay || escapeEvent.defaultPrevented;
}

export function useAndroidBack() {
  if (!isPlatform('android')) return;
  onMount(() => {
    const onBack = (event: Event) => {
      if (dismissAndroidBackOverlay()) {
        event.preventDefault();
        return;
      }
      const navigation = new Event('android-navigate-back', {
        cancelable: true,
      });
      if (!window.dispatchEvent(navigation)) event.preventDefault();
    };
    window.addEventListener('android-back', onBack);
    onCleanup(() => window.removeEventListener('android-back', onBack));
  });
}

export function useAndroidBackNavigation(navigateBack: () => boolean) {
  if (!isPlatform('android')) return;
  onMount(() => {
    const onBack = (event: Event) => {
      if (!event.defaultPrevented && navigateBack()) event.preventDefault();
    };
    window.addEventListener('android-navigate-back', onBack);
    onCleanup(() =>
      window.removeEventListener('android-navigate-back', onBack)
    );
  });
}
