import { ProjectTimeTab } from '@app/features/time-tracking/project-time';
import { Match, Show, Switch } from 'solid-js';
import type { ProjectWorkspaceProps } from '../context/project-workspace';
import { canEditProject } from '../core/project';
import { ProjectTasksList } from './project-tasks-list';
import { ProjectSummary } from './shared/project-summary';
import { ProjectWorkspaceLayout } from './shared/project-workspace-layout';

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  return (
    <ProjectWorkspaceLayout {...props}>
      <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
        <Show when={props.source.error()}>
          <p role="status" class="px-6 py-2 text-sm text-ink-muted">
            Could not refresh this project.
          </p>
        </Show>
        <div class="min-h-0 flex-1">
          <Switch>
            <Match when={props.section === 'overview'}>
              <div class="h-full overflow-y-auto px-6 pb-8 pt-12 touch:pt-[calc(var(--mobile-content-inset-top,0px)+1.5rem)]">
                <div class="mx-auto max-w-3xl">
                  <ProjectSummary {...props}>
                    <div aria-label="Project description">
                      {props.description}
                    </div>
                    {props.discussion}
                  </ProjectSummary>
                </div>
              </div>
            </Match>
            <Match when={props.section === 'tasks'}>
              <ProjectTasksList
                projectId={props.project.id}
                project={props.project}
                source={props.source}
                onOpenTask={props.onOpenTask}
                onCreateTask={
                  canEditProject(props.project) ? props.onCreateTask : undefined
                }
              />
            </Match>
            <Match when={props.section === 'time'}>
              <ProjectTimeTab
                project={props.project}
                onOpenTask={props.onOpenTask}
              />
            </Match>
          </Switch>
        </div>
      </div>
    </ProjectWorkspaceLayout>
  );
}
