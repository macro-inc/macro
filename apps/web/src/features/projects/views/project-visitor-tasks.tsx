import { useNavigate } from '@app/lib/split-router';
import { projectTaskRoute } from '@app/routes/routes';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { hasValue } from '@property/utils';
import { EmptyStatePanel } from '@ui';
import { For, Match, Switch } from 'solid-js';
import { useProjectsContext } from '../context/projects-context';
import type { ProjectSection } from '../core/project';

/**
 * A project's tasks as a caller with no account reads them: every task in
 * the project, read-only, each opening in the same pane.
 */
export function ProjectVisitorTasks(props: {
  projectId: string;
  section: ProjectSection;
}) {
  const navigate = useNavigate();
  const source = useProjectsContext().createVisitorTasksSource(
    () => props.projectId
  );
  const openTask = (taskId: string) =>
    fireAndForget(
      navigate({
        route: projectTaskRoute,
        params: {
          projectId: props.projectId,
          section: props.section,
          taskId,
        },
      }),
      'project-visitor-tasks'
    );
  return (
    <Switch>
      <Match when={source.failed()}>
        <EmptyStatePanel
          centered
          title="Tasks unavailable"
          description="This project's tasks could not be loaded."
        />
      </Match>
      <Match when={source.tasks()?.length === 0}>
        <EmptyStatePanel
          centered
          title="No tasks"
          description="This project's tasks appear here."
        />
      </Match>
      <Match when={source.tasks()}>
        {(tasks) => (
          <ul
            aria-label="Project tasks"
            class="h-full divide-y divide-edge-muted overflow-y-auto px-4 py-2"
          >
            <For each={tasks()}>
              {(task) => (
                <li class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 py-2 touch:pt-0">
                  <button
                    type="button"
                    class="min-w-0 grow basis-40 truncate text-left text-sm not-touch:hover:underline touch:min-h-[44px]"
                    onClick={() => openTask(task.id)}
                  >
                    {task.name || blockNameToDefaultFile('task')}
                  </button>
                  <div class="flex min-w-0 flex-wrap items-center gap-1.5">
                    <For each={task.properties.filter(hasValue)}>
                      {(property) => (
                        <PropertyValuePill
                          property={property}
                          canEdit={false}
                        />
                      )}
                    </For>
                  </div>
                </li>
              )}
            </For>
          </ul>
        )}
      </Match>
    </Switch>
  );
}
