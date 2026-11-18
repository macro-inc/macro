import { ViewSidebar } from '@app/components/view-shell';
import { Show } from 'solid-js';
import { isProjectTab } from '../core/task-navigation';
import { useTasksView } from '../tasks-view-context';
import { TasksFilterDrawer } from './TasksFilterDrawer';

/**
 * Touch list controls; task views, projects, and saved views live in the
 * sidebar sheet.
 */
export function TasksMobileControls() {
  const { state } = useTasksView();

  return (
    <div class="flex h-10 min-w-0 flex-1 items-center">
      <div class="pointer-events-auto flex items-center gap-2">
        <ViewSidebar.Toggle action="expand" presentation="pill" />
        <Show when={!isProjectTab(state.tab)}>
          <TasksFilterDrawer />
        </Show>
      </div>
    </div>
  );
}
