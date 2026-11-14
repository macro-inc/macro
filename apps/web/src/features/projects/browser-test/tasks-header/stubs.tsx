// Stand-ins for the task list's data and filter modules. The header row, its
// search field and its actions stay real.
import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Button } from '@ui';
import { createContext, type ParentProps, Show, useContext } from 'solid-js';
import { createStore, type SetStoreFunction } from 'solid-js/store';

type TasksViewState = { search: string };
type TasksView = {
  state: TasksViewState;
  setState: SetStoreFunction<TasksViewState>;
};

const TasksViewContext = createContext<TasksView>();

export function TasksViewProvider(props: ParentProps) {
  const [state, setState] = createStore<TasksViewState>({ search: '' });
  return (
    <TasksViewContext.Provider value={{ state, setState }}>
      {props.children}
    </TasksViewContext.Provider>
  );
}

export function useTasksView(): TasksView {
  const view = useContext(TasksViewContext);
  if (!view) throw new Error('TasksViewProvider is required');
  return view;
}

export function TasksContent() {
  return <p class="p-4 text-sm text-ink-muted">No tasks in this view.</p>;
}

export function TasksControls() {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Button variant="secondary" size="icon-md" aria-label="Filter tasks" />
      }
    >
      <MobileFilterDrawer
        triggerLabel="Open task filters"
        label="Task list controls"
        activeCount={0}
        onClear={() => {}}
      >
        <p>Filters</p>
      </MobileFilterDrawer>
    </Show>
  );
}

export function createProjectTasksDataSource(): never {
  throw new Error('The header fixture has no task data');
}

export function PropertyEntitySelector() {
  return <input aria-label="Search tasks" />;
}
