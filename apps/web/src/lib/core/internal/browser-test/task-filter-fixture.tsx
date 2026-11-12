import { ListFilterDropdown } from '@app/components/view-shell/ListDropdowns';
import { TasksFilterDrawer } from '@app/features/tasks-view/components/TasksFilterDrawer';
import { useTaskFilters } from '@app/features/tasks-view/filters/use-task-filters';
import { Show } from 'solid-js';
import { requests, VIEWER } from './list-filter-adapters';
import { changeViewer, lookupIds } from './network';
import {
  account,
  completionPending,
  completionRequests,
  holdCompletion,
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
        <button onClick={holdCompletion}>Hold model reply</button>
        <button onClick={releaseCompletion}>Release model reply</button>
        <button onClick={() => setTaskState('facets', 'priority', ['urgent'])}>
          Manual priority
        </button>
        <button onClick={() => setTaskState('search', 'brief')}>
          Search tasks
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
