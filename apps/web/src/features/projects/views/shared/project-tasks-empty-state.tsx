import { PROJECTS_DOCS_URL } from '@app/constants/docs-links';
import { t } from '@app/lib/i18n';
import EmptyStateTasksGraphic from '@design/empty-state-tasks.svg';
import BookOpenIcon from '@icon/system/regular/book-open.svg';
import { EmptyStatePanel } from '@ui';
import { AddProjectTasks } from '../../add-project-tasks';
import type { ProjectDetail } from '../../core/project';

export function ProjectTasksEmptyState(props: {
  project: ProjectDetail;
  onCreateTask?: () => void;
}) {
  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateTasksGraphic}
      title={t('viewMenus.noTasksYet')}
      description={t('viewMenus.emptyProjectTasks')}
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
