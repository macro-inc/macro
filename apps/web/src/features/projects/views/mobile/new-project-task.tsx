import { NEW_TASK_TITLE_SELECTOR } from '@app/features/task-composer/new-task-title-focus';
import { t } from '@app/lib/i18n';
import { activeElement } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { MobileCreateButton } from '@components/app/mobile/MobileCreateButton';
import { triggerFocusNewElement } from '@core/directive/focusInput';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import { Show } from 'solid-js';

/**
 * The project's floating Task pill. It takes the slot from the Tasks view's
 * own pill, which would create a task outside the project, and leaves the slot
 * empty for people who can't add tasks to the project.
 */
export function MobileNewProjectTask(props: { onCreateTask?: () => void }) {
  return (
    <FloatRegion
      region="accessory"
      // Replace the app action (-1), but yield to screen composers (0).
      priority={-0.5}
      active={() =>
        !virtualKeyboardVisible() && !isEditableInput(activeElement())
      }
    >
      <Show when={props.onCreateTask}>
        {(createTask) => (
          <div class="flex justify-end px-(--mobile-chrome-gutter)">
            <MobileCreateButton
              label={t('create.taskLabel')}
              ariaLabel={t('mobile.newTask')}
              onClick={() => {
                // Raise the keyboard within this tap; the composer mounts later.
                triggerFocusNewElement(NEW_TASK_TITLE_SELECTOR, {
                  touchOnly: true,
                });
                createTask()();
              }}
            />
          </div>
        )}
      </Show>
    </FloatRegion>
  );
}
