import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { MobileNewProjectTask } from './views/mobile/new-project-task';
import { NewProjectTaskButton } from './views/new-project-task';

/** New task in a project's Tasks header on desktop; touch floats a pill. */
export function NewProjectTask(props: { onCreateTask?: () => void }) {
  return (
    <Show when={!isTouchDevice() && props.onCreateTask}>
      {(createTask) => <NewProjectTaskButton onCreateTask={createTask()} />}
    </Show>
  );
}

/**
 * On touch, every tab of a project floats a Task pill that creates the task in
 * the project, in place of the Tasks view's own.
 */
export function NewProjectTaskPill(props: { onCreateTask?: () => void }) {
  return (
    <Show when={isTouchDevice()}>
      <MobileNewProjectTask onCreateTask={props.onCreateTask} />
    </Show>
  );
}
