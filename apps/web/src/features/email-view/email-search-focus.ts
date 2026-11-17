import type { SplitPanelContextType } from '@components/app/split-layout/context';

const EMAIL_LIST_SELECTOR = '[role="grid"][aria-label="Email"]';

/**
 * Whether Tab and Shift+Tab switch the Email tabs. While the list itself has
 * focus they move browser focus through its rows instead.
 */
export function switchesEmailTabs(event: KeyboardEvent | undefined) {
  return !(
    event?.target instanceof Element &&
    event.target.closest(EMAIL_LIST_SELECTOR)
  );
}

/**
 * Where Email's search field hands the keyboard on ArrowDown, Enter and
 * Escape: the split panel, where the list's keys run before anyone searched,
 * so Tab still switches tabs. The list element would turn Tab into browser
 * focus moves through its rows.
 */
export function focusEmailSearchResults(
  panel: Pick<SplitPanelContextType, 'panelRef'>
) {
  panel.panelRef()?.focus();
}
