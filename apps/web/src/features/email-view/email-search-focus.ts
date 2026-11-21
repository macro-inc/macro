import type { SplitPanelContextType } from '@components/app/split-layout/context';

const EMAIL_LIST_SELECTOR = '[role="grid"][aria-label="Email"]';

/**
 * Whether Tab and Shift+Tab switch the Email tabs: everywhere in Email,
 * including while the list itself has focus, except on a control inside the
 * list (a row's controls, Load more), where they move browser focus so those
 * controls stay reachable.
 */
export function switchesEmailTabs(event: KeyboardEvent | undefined) {
  const target = event?.target;
  if (!(target instanceof Element)) return true;

  const list = target.closest(EMAIL_LIST_SELECTOR);
  return !list || list === target;
}

/**
 * Where Email's search field hands the keyboard on ArrowDown, Enter and
 * Escape: the split panel, where the list's keys run before anyone searched.
 * Without a list on screen (a saved view that is loading or unavailable) the
 * keyboard stays with the field.
 */
export function focusEmailSearchResults(
  panel: Pick<SplitPanelContextType, 'panelRef'>,
  list: HTMLElement | undefined
) {
  if (!list?.isConnected) return;

  panel.panelRef()?.focus();
}
