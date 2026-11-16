import { TasksFilterDrawer } from '@app/features/tasks-view/components/TasksFilterDrawer';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import { t } from '@app/lib/i18n';
import { useSidePanel } from '@components/app/side-panel';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { AddProjectTasks } from '../../add-project-tasks';
import { ProjectProgress } from '../../components/project-progress';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { canEditProject } from '../../core/project';
import { showProjectTaskAction } from '../../primitives/project-task-action';
import { ProjectTasksProvider } from '../../project-tasks-provider';
import { ProjectSummary } from '../shared/project-summary';
import { ProjectTasksEmptyState } from '../shared/project-tasks-empty-state';
import { ProjectWorkspaceLayout } from '../shared/project-workspace-layout';
import { MobileProjectDescription } from './project-description';

export function MobileProjectWorkspace(props: ProjectWorkspaceProps) {
  const details = useSidePanel();
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [summary, setSummary] = createSignal<HTMLDivElement>();
  const [heading, setHeading] = createSignal<HTMLDivElement>();
  const summarySize = createElementSize(summary);
  const headingSize = createElementSize(heading);
  const [scrollTop, setScrollTop] = createSignal(0);
  const showTaskAction = () =>
    showProjectTaskAction(scrollTop(), summarySize.height ?? 0);
  return (
    <ProjectWorkspaceLayout {...props}>
      <ProjectTasksProvider
        projectId={props.project.id}
        onOpenTask={props.onOpenTask}
        onCreateTask={
          canEditProject(props.project) ? props.onCreateTask : undefined
        }
      >
        <div
          ref={setScroller}
          class="h-full min-h-0 w-full overflow-y-auto overscroll-none pb-(--mobile-content-inset-bottom)"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div ref={setSummary} class="px-5 pt-4 pb-6">
            <ProjectSummary
              {...props}
              propertyAction={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => details?.setIsOpen(true)}
                >
                  {t('common.more')}
                </Button>
              }
            >
              <MobileProjectDescription>
                {props.description}
              </MobileProjectDescription>
              {props.discussion}
            </ProjectSummary>
          </div>
          <div
            ref={setHeading}
            class="sticky top-0 z-10 flex h-14 items-center gap-2 bg-panel px-4"
          >
            <ProjectProgress project={props.project} />
            <h2 class="text-base font-semibold">{t('nav.tasks')}</h2>
            <span class="text-sm text-ink-muted">
              {t('common.progressTasksDone', {
                completed: props.project.completedTaskCount ?? 0,
                count: props.project.taskCount ?? props.project.taskIds.length,
              })}
            </span>
            <div class="ml-auto">
              <TasksFilterDrawer />
            </div>
          </div>
          <TasksContent
            scrollContainer={scroller()}
            scrollStart={(summarySize.height ?? 0) + (headingSize.height ?? 0)}
            stickyInset={headingSize.height ?? 0}
            emptyContent={
              props.project.taskIds.length === 0 ? (
                <ProjectTasksEmptyState
                  project={props.project}
                  onCreateTask={
                    canEditProject(props.project)
                      ? props.onCreateTask
                      : undefined
                  }
                />
              ) : undefined
            }
          />
        </div>
        <Show when={canEditProject(props.project)}>
          <AddProjectTasks
            project={props.project}
            onCreateTask={props.onCreateTask}
            hidden={!showTaskAction()}
          />
        </Show>
      </ProjectTasksProvider>
    </ProjectWorkspaceLayout>
  );
}
