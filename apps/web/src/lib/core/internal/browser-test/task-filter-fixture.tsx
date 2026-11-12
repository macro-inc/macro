import { ListFilterDropdown } from '@app/components/view-shell/ListDropdowns';
import { TasksFilterDrawer } from '@app/features/tasks-view/components/TasksFilterDrawer';
import { taskMatchesView } from '@app/features/tasks-view/filters/task-predicates';
import {
  captureTaskSavedView,
  materializeTaskSavedView,
  type TaskSavedViewConfig,
} from '@app/features/tasks-view/filters/task-saved-view';
import { useTaskFilters } from '@app/features/tasks-view/filters/use-task-filters';
import {
  boardEntity,
  boardProperty,
} from '@app/features/tasks-view/tests/task-board-fixture';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { createSignal, For, Show } from 'solid-js';
import { requests, VIEWER } from './list-filter-adapters';
import { changeViewer, lookupIds } from './network';
import {
  account,
  completionPending,
  completionRequests,
  holdCompletion,
  PROJECT_A,
  PROJECT_B,
  referenceRequests,
  releaseCompletion,
  setAccount,
  setNavigation,
  setTaskState,
  taskState,
} from './task-filter-adapters';

export function TaskFilterFixture() {
  changeViewer(VIEWER);
  const filters = useTaskFilters();
  const [saved, setSaved] = createSignal<TaskSavedViewConfig>();
  const tasks = [
    boardEntity('Alpha task', [
      boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
        type: 'EntityReference',
        value: [{ entity_type: 'INITIATIVE', entity_id: PROJECT_A }],
      }),
    ]),
    boardEntity('Beta task', [
      boardProperty(SYSTEM_PROPERTY_IDS.PROJECT, {
        type: 'EntityReference',
        value: [{ entity_type: 'INITIATIVE', entity_id: PROJECT_B }],
      }),
    ]),
    boardEntity('Unlinked task'),
  ];
  const save = () => {
    const result = captureTaskSavedView({
      tab: 'team-tasks',
      facets: taskState.facets,
      context: { tagPropertyDefinitionByOptionId: new Map() },
    });
    if (result.isErr()) throw new Error(result.error);
    setSaved(result.value);
    filters.clear();
  };
  return (
    <main class="p-6 bg-page text-ink min-h-screen">
      <Show
        when={matchMedia('(pointer: coarse)').matches}
        fallback={
          <ListFilterDropdown
            label="Filter tasks"
            groups={filters.groups()}
            isSelected={filters.isSelected}
            selectedIds={filters.selectedIds}
            onSelectionChange={filters.setSelected}
            onClear={filters.clear}
            aiFilter={{ onSubmit: filters.applyDescription }}
          />
        }
      >
        <TasksFilterDrawer />
      </Show>
      <div class="mt-20 flex flex-col items-start gap-2">
        <button
          onClick={() => setTaskState('singleProject', (value) => !value)}
        >
          Toggle project scope
        </button>
        <button onClick={() => setTaskState('projectsEnabled', false)}>
          Disable projects
        </button>
        <button onClick={save}>Save filter view</button>
        <button
          onClick={() => {
            const config = saved();
            if (config)
              setTaskState('facets', materializeTaskSavedView(config).facets);
          }}
        >
          Restore filter view
        </button>
        <button onClick={holdCompletion}>Hold model reply</button>
        <button onClick={releaseCompletion}>Release model reply</button>
        <button onClick={() => setTaskState('facets', 'priority', ['urgent'])}>
          Manual priority
        </button>
        <button onClick={() => setNavigation({ id: 'other-tasks' })}>
          Navigate away
        </button>
        <button
          onClick={() =>
            setAccount({ ...account(), session: account().session + 1 })
          }
        >
          Replace login
        </button>
      </div>
      <ul aria-label="Matching tasks">
        <For
          each={tasks.filter((task) =>
            taskMatchesView(task, {
              tab: 'team-tasks',
              userId: VIEWER,
              facets: taskState.facets,
            })
          )}
        >
          {(task) => <li>{task.name}</li>}
        </For>
      </ul>
      <output hidden data-testid="task-facets">
        {JSON.stringify(taskState.facets)}
      </output>
      <output hidden data-testid="task-requests">
        {requests()}
      </output>
      <output hidden data-testid="task-lookup">
        {JSON.stringify(lookupIds())}
      </output>
      <output hidden data-testid="task-reference-requests">
        {JSON.stringify(referenceRequests())}
      </output>
      <output hidden data-testid="task-completion-requests">
        {JSON.stringify(completionRequests())}
      </output>
      <output hidden data-testid="task-completion-pending">
        {String(completionPending())}
      </output>
    </main>
  );
}
