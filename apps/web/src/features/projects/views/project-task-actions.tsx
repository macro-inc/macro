import { AddProjectTasks } from '../add-project-tasks';
import type { ProjectDetail } from '../core/project';

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
