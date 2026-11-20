import { onCleanup } from 'solid-js';

/**
 * Kobalte defers collection autofocus even when onOpenAutoFocus is prevented.
 * Wait beyond that timeout and the portaled dismissable layer's registration.
 */
export function focusSearchAfterMenuOpen(
  input: () => HTMLInputElement | undefined
) {
  let frame: number | undefined;
  const timer = setTimeout(() => {
    frame = requestAnimationFrame(() => {
      const search = input();
      if (search?.isConnected) search.focus();
    });
  });
  return () => {
    clearTimeout(timer);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}

/**
 * Hovering a submenu trigger repeatedly steals focus from its search.
 * Reclaim only startup/trigger focus, never deliberate navigation to a row.
 */
export function keepSearchFocused(input: () => HTMLInputElement | undefined) {
  let navigating = false;
  let disposed = false;
  const cancelFocus = focusSearchAfterMenuOpen(() =>
    navigating ? undefined : input()
  );
  const search = input();
  const menu = search?.closest('[role="menu"]');
  const onNavigate = (event: Event) => {
    if (!(event.target instanceof Element)) return;

    const fromSearch = event.target === search;
    const arrowNavigation =
      event instanceof KeyboardEvent &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp');
    const fromRow = event.target.closest(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], input[type="range"]'
    );
    if (fromRow || (fromSearch && arrowNavigation)) navigating = true;
  };
  for (const type of ['pointermove', 'pointerdown', 'keydown']) {
    menu?.addEventListener(type, onNavigate, true);
  }
  const onBlur = () => {
    queueMicrotask(() => {
      if (disposed) return;
      const active = document.activeElement;
      const triggerId = menu?.getAttribute('aria-labelledby');
      const initialRowFocus =
        !navigating && menu && active?.closest('[role="menu"]') === menu;
      if (
        search?.isConnected &&
        (triggerId === active?.id || initialRowFocus)
      ) {
        search.focus();
      }
    });
  };
  search?.addEventListener('blur', onBlur);
  onCleanup(() => {
    disposed = true;
    cancelFocus();
    search?.removeEventListener('blur', onBlur);
    for (const type of ['pointermove', 'pointerdown', 'keydown']) {
      menu?.removeEventListener(type, onNavigate, true);
    }
  });
}
