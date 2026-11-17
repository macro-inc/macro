import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { MobileNewProjectTask } from './views/mobile/new-project-task';
import { NewProjectTaskButton } from './views/new-project-task';

/**
 * New task on a project's Tasks tab: a header button on desktop, and on touch
 * the floating create pill, as on the Tasks view.
 */
export function NewProjectTask(props: { onCreateTask?: () => void }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Show when={props.onCreateTask}>
          {(createTask) => <NewProjectTaskButton onCreateTask={createTask()} />}
        </Show>
      }
    >
      <MobileNewProjectTask onCreateTask={props.onCreateTask} />
    </Show>
  );
}
