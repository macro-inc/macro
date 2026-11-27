import type { SplitPanelContextType } from '@components/app/split-layout/context';

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
