/**
 * Marks a rename dialog's name field. The tap that opens the dialog passes
 * `RENAME_FIELD_SELECTOR` to `triggerFocusNewElement` to raise the keyboard.
 */
export const RENAME_FIELD_ATTRIBUTE = 'data-rename-field';
export const RENAME_FIELD_SELECTOR = `[${RENAME_FIELD_ATTRIBUTE}]`;
