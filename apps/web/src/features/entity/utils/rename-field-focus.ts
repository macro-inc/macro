import {
  focusStandInActive,
  triggerFocusInput,
} from '@core/directive/focusInput';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/** Marks a rename dialog's name field, so the tap that opens one can find it. */
export const RENAME_FIELD_ATTRIBUTE = 'data-rename-field';

const renameFields = () =>
  document.querySelectorAll<HTMLElement>(`[${RENAME_FIELD_ATTRIBUTE}]`);

/**
 * Raises the phone keyboard for the name field of the rename dialog this tap
 * opens. iOS shows it only for a focus made inside the tap, and the dialog's
 * field mounts later, so a stand-in input holds it until the new field
 * appears. Call it synchronously in the tap, before opening the dialog: a
 * field already on the page (a closing dialog's) is not the one to focus.
 */
export function raiseKeyboardForRenameField() {
  if (!isTouchDevice() || focusStandInActive()) return;

  const open = new Set(renameFields());
  triggerFocusInput(() =>
    Array.from(renameFields()).find((field) => !open.has(field))
  );
}
