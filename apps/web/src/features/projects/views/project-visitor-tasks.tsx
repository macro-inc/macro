import { useNavigate } from '@app/lib/split-router';
import { projectTaskRoute } from '@app/routes/routes';
import { blockNameToDefaultFile } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { PropertyValuePill } from '@property/component/PropertyValuePill';
import { hasValue } from '@property/utils';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { EmptyStatePanel } from '@ui';
import { For, Match, Switch } from 'solid-js';
import type { ProjectSection } from '../core/project';
import { createProjectVisitorTasksQuery } from '../queries/project-visitor-tasks';

/**
 * A project's tasks as a caller with no account reads them: the ones they may
 * view, read-only, each opening in the same pane.
 */
export function ProjectVisitorTasks(props: {
  projectId: string;
  section: ProjectSection;
}) {
  const navigate = useNavigate();
  const query = createProjectVisitorTasksQuery(
    getGraphqlSoupClient,
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
      <Match when={query.isError}>
        <EmptyStatePanel
          centered
          title="Tasks unavailable"
          description="This project's tasks could not be loaded."
        />
      </Match>
      <Match when={query.data?.length === 0}>
        <EmptyStatePanel
          centered
          title="No tasks"
          description="Tasks you can see in this project appear here."
        />
      </Match>
      <Match when={query.data}>
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
