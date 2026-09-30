import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Accessor } from 'solid-js';
import { SearchState } from './mobileSearchState';

/** Overlay the dock query without persisting it into the view's own state. */
export function useMobileSearchText(
  localText: Accessor<string>,
  isActive: Accessor<boolean>
): Accessor<string> {
  return () =>
    isTouchDevice() && SearchState.isOpen() && isActive()
      ? SearchState.query()
      : localText();
}
