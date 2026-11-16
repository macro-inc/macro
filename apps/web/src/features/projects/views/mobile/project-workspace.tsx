import { TasksFilterDrawer } from '@app/features/tasks-view/components/TasksFilterDrawer';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import { t } from '@app/lib/i18n';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, Show } from 'solid-js';
import { AddProjectTasks } from '../../add-project-tasks';
import { ProjectProgress } from '../../components/project-progress';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { canEditProject } from '../../core/project';
import { ProjectTasksProvider } from '../../project-tasks-provider';
import { ProjectSummary } from '../shared/project-summary';
import { ProjectTasksEmptyState } from '../shared/project-tasks-empty-state';
import { ProjectWorkspaceLayout } from '../shared/project-workspace-layout';
import { MobileProjectDescription } from './project-description';
import { ProjectDetailsAction } from './project-details-action';

export function MobileProjectWorkspace(props: ProjectWorkspaceProps) {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [summary, setSummary] = createSignal<HTMLDivElement>();
  const [heading, setHeading] = createSignal<HTMLDivElement>();
  const summarySize = createElementSize(summary);
  const headingSize = createElementSize(heading);
  return (
    <ProjectWorkspaceLayout {...props}>
      <ProjectTasksProvider
        projectId={props.project.id}
        source={props.source}
        onOpenTask={props.onOpenTask}
        onCreateTask={
          canEditProject(props.project) ? props.onCreateTask : undefined
        }
      >
        <div
          ref={setScroller}
          class="h-full min-h-0 w-full overflow-y-auto overscroll-none pb-[calc(var(--mobile-content-inset-bottom,0px)+16px)]"
        >
          <div ref={setSummary} class="px-5 pt-4 pb-6">
            <ProjectSummary
              {...props}
              propertyAction={<ProjectDetailsAction />}
            >
              <MobileProjectDescription>
                {props.description}
              </MobileProjectDescription>
              {props.discussion}
            </ProjectSummary>
          </div>
          <section aria-label={t('nav.tasks')}>
            <div
              ref={setHeading}
              class="sticky top-0 z-10 flex h-14 items-center gap-2 bg-panel px-4"
            >
              <ProjectProgress project={props.project} size="md" />
              <h2 class="text-base font-semibold">{t('nav.tasks')}</h2>
              <span class="text-sm text-ink-muted">
                {t('common.progressTasksDone', {
                  completed: props.project.completedTaskCount ?? 0,
                  count:
                    props.project.taskCount ?? props.project.taskIds.length,
                })}
              </span>
              <div class="ml-auto">
                <TasksFilterDrawer />
              </div>
            </div>
            <Show
              when={props.project.taskIds.length > 0}
              fallback={<ProjectTasksEmptyState project={props.project} />}
            >
              <TasksContent
                scrollContainer={scroller()}
                scrollStart={
                  (summarySize.height ?? 0) + (headingSize.height ?? 0) + 4
                }
                stickyInset={headingSize.height ?? 0}
              />
            </Show>
          </section>
          <Show when={canEditProject(props.project)}>
            <AddProjectTasks
              project={props.project}
              onCreateTask={props.onCreateTask}
            />
          </Show>
        </div>
      </ProjectTasksProvider>
    </ProjectWorkspaceLayout>
  );
}
