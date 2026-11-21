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
  /** A populated project whose current list filters return no tasks. */
  search?: string;
}) {
  const copy = () => {
    if (props.search === undefined)
      return {
        title: t('viewMenus.noTasksYet'),
        description: t('viewMenus.emptyProjectTasks'),
      };
    if (props.search.trim())
      return {
        title: t('viewMenus.noTaskSearchResults'),
        description: t('viewMenus.emptyTaskSearch'),
      };
    return {
      title: t('viewMenus.noTasksToShow'),
      description: t('viewMenus.emptyTaskView'),
    };
  };
  return (
    <EmptyStatePanel
      centered
      graphic={EmptyStateTasksGraphic}
      graphicClass={props.search !== undefined ? 'size-32' : undefined}
      title={copy().title}
      description={copy().description}
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
