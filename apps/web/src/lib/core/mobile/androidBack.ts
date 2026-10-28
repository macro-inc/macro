import { isPlatform } from '@core/util/platform';
import { onCleanup, onMount } from 'solid-js';

declare global {
  interface WindowEventMap {
    'android-back': Event;
    'android-navigate-back': Event;
  }
}

function isEditable(element: Element | null): boolean {
  return (
    element?.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"])'
    ) != null
  );
}

/**
 * Use the same Escape handlers as touch sheets, menus and editor popups.
 * Editor popups carry no top-layer marker, so a focused editor also receives
 * Escape; nothing else does, keeping Back away from unrelated Escape hotkeys.
 */
function dismissAndroidBackOverlay(): boolean {
  // Kobalte and corvu mark their top layers with these library attributes.
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
  const target = document.activeElement;
  if (!overlay && !isEditable(target)) return false;
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  (target ?? document.body).dispatchEvent(escapeEvent);
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
