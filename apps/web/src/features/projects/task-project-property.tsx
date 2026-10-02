import { Projects } from './projects';
import { TaskProjectProperty as TaskProjectPropertyContent } from './views/task-project-property';

export function TaskProjectProperty(props: {
  taskId: string;
  canEdit: boolean;
}) {
  return (
    <Projects>
      <TaskProjectPropertyContent {...props} />
    </Projects>
  );
}
