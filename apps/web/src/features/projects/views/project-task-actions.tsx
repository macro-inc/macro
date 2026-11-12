import PlusIcon from '@icon/system/regular/plus.svg';
import { Button } from '@ui';
import type { ProjectDetail } from '../core/project';
import { AddProjectTasks } from './add-project-tasks';

export function ProjectTaskActions(props: {
  project: ProjectDetail;
  onCreateTask: () => void;
}) {
  return (
    <AddProjectTasks
      project={props.project}
      onCreateTask={props.onCreateTask}
    />
  );
}

export function ProjectTasksEmptyState(props: {
  project: ProjectDetail;
  onCreateTask?: () => void;
}) {
  return (
    <div class="flex flex-col items-center gap-4 rounded-xl border border-edge-muted px-6 py-8">
      <h2 class="text-base font-medium text-ink">No tasks yet</h2>
      {props.onCreateTask && (
        <div class="flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={props.onCreateTask}>
            <PlusIcon class="size-4" />
            New task
          </Button>
          <AddProjectTasks project={props.project} inline />
        </div>
      )}
    </div>
  );
}
