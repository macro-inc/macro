/**
 * Marks a task composer's title. The tap that opens a composer passes
 * `NEW_TASK_TITLE_SELECTOR` to `triggerFocusNewElement` to raise the
 * keyboard; kept apart from the composer so callers don't load it.
 */
export const TASK_COMPOSER_TITLE_ATTRIBUTE = 'data-task-composer-title';
export const NEW_TASK_TITLE_SELECTOR = `[${TASK_COMPOSER_TITLE_ATTRIBUTE}] [contenteditable="true"]`;
