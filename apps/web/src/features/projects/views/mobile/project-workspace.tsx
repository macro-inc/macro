import { TasksFilterDrawer } from '@app/features/tasks-view/components/TasksFilterDrawer';
import { TasksContent } from '@app/features/tasks-view/tasks-content';
import { t } from '@app/lib/i18n';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { createElementSize } from '@solid-primitives/resize-observer';
import { createSignal, Show } from 'solid-js';
import { AddProjectTasks } from '../../add-project-tasks';
import { ProjectProgress } from '../../components/project-progress';
import type { ProjectWorkspaceProps } from '../../context/project-workspace';
import { canEditProject } from '../../core/project';
import { createProjectTasksSticky } from '../../primitives/create-project-tasks-sticky';
import { ProjectTasksProvider } from '../../project-tasks-provider';
import { ProjectSummary } from '../shared/project-summary';
import { ProjectTasksEmptyState } from '../shared/project-tasks-empty-state';
import { ProjectWorkspaceLayout } from '../shared/project-workspace-layout';
import { MobileProjectDescription } from './project-description';

export function MobileProjectWorkspace(props: ProjectWorkspaceProps) {
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  const [summary, setSummary] = createSignal<HTMLDivElement>();
  const [heading, setHeading] = createSignal<HTMLDivElement>();
  const [description, setDescription] = createSignal<HTMLDivElement>();
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>();
  const tasksStuck = createProjectTasksSticky(scroller, sentinel);
  const viewportSize = createElementSize(scroller);
  const descriptionSize = createElementSize(description);
  const summarySize = createElementSize(summary);
  const headingSize = createElementSize(heading);
  const descriptionHeight = () => {
    const viewport = viewportSize.height;
    const summary = summarySize.height;
    const description = descriptionSize.height;
    const heading = headingSize.height;
    if (!viewport || summary == null || description == null || heading == null)
      return undefined;
    // Remove the description from the measured summary, then reserve chrome,
    // the Tasks heading, and 24px of the first row before choosing a line limit.
    return (
      viewport -
      (summary - description) -
      heading -
      FloatRegions.hostHeight() -
      16 -
      24
    );
  };
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
          <div ref={setSummary} class="px-5 pt-4 pb-8">
            <ProjectSummary {...props}>
              <MobileProjectDescription
                ref={setDescription}
                availableHeight={descriptionHeight()}
              >
                {props.description}
              </MobileProjectDescription>
              {props.discussion}
            </ProjectSummary>
          </div>
          <div aria-hidden="true" class="relative h-0">
            <div ref={setSentinel} class="absolute -top-px h-px w-px" />
          </div>
          <section aria-label={t('nav.tasks')}>
            <div
              ref={setHeading}
              class="sticky top-0 z-10 flex h-14 items-center gap-2 bg-panel px-4"
              data-stuck={tasksStuck() ? '' : undefined}
            >
              {/* Use the same gradient utilities as ScrollIndicators without its scroll listener. */}
              <div
                aria-hidden="true"
                class="pointer-events-none absolute inset-x-0 top-full h-5 bg-linear-to-b from-(--scroll-indicator-from) to-transparent motion-safe:transition-opacity motion-safe:duration-150"
                classList={{
                  'opacity-0': !tasksStuck(),
                  'opacity-100': tasksStuck(),
                }}
                style={{ '--scroll-indicator-from': 'var(--color-panel)' }}
              />
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
