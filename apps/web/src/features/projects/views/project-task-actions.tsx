import { PROJECTS_DOCS_URL } from '@app/constants/docs-links';
import EmptyStateTasksGraphic from '@design/empty-state-tasks.svg';
import BookOpenIcon from '@icon/system/regular/book-open.svg';
import { EmptyStatePanel } from '@ui';
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

export function ProjectTasksEmptyState(props: {
  project: ProjectDetail;
  onCreateTask?: () => void;
}) {
  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateTasksGraphic}
      title="No tasks yet"
      description="Add tasks to plan and track this project's work."
      documentationUrl={PROJECTS_DOCS_URL}
      documentationIcon={BookOpenIcon}
      primaryActionContent={
        props.onCreateTask && (
          <AddProjectTasks
            project={props.project}
            onCreateTask={props.onCreateTask}
            inline
          />
        )
      }
    />
  );
}
