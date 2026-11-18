import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import type { ProjectDetail } from './core/project';
import { AddProjectTasksMenu } from './views/add-project-tasks';
import { MobileAddProjectTasks } from './views/mobile/add-project-tasks';

/** Add existing tasks: an anchored menu on desktop, a picker sheet on touch. */
export function AddProjectTasks(props: { project: ProjectDetail }) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={<AddProjectTasksMenu project={props.project} />}
    >
      <MobileAddProjectTasks project={props.project} />
    </Show>
  );
}
