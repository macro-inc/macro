import {
  focusStandInActive,
  triggerFocusInput,
} from '@core/directive/focusInput';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/** Marks a task composer's title, so the tap that opens one can find it. */
export const TASK_COMPOSER_TITLE_ATTRIBUTE = 'data-task-composer-title';

const titleEditors = () =>
  document.querySelectorAll<HTMLElement>(
    `[${TASK_COMPOSER_TITLE_ATTRIBUTE}] [contenteditable="true"]`
  );

/**
 * Raises the phone keyboard for the title of the task composer this tap
 * opens. iOS shows it only for a focus made inside the tap, and the composer
 * mounts later, so a stand-in input holds it until the new title appears.
 * Call it synchronously in the tap; kept apart from the composer so callers
 * don't load it.
 */
export function raiseKeyboardForNewTaskTitle() {
  if (!isTouchDevice() || focusStandInActive()) return;
  const open = new Set(titleEditors());
  triggerFocusInput(() =>
    Array.from(titleEditors()).find((title) => !open.has(title))
  );
}
