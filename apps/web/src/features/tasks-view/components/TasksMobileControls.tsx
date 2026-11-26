import { useViewControlHotkeys, ViewSidebar } from '@app/components/view-shell';
import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { Show } from 'solid-js';
import { isProjectTab } from '../core/task-navigation';
import { useTasksView } from '../tasks-view-context';
import { TasksFilterDrawer } from './TasksFilterDrawer';

/**
 * Touch list controls; task views, projects, and saved views live in the
 * sidebar sheet.
 */
export function TasksMobileControls(props: {
  focusSearchResults?: () => void;
}) {
  const { state, setState } = useTasksView();
  const panel = useSplitPanelOrThrow();
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    search: {
      description: 'Search tasks',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });

  return (
    <div class="flex min-h-10 min-w-0 flex-1 items-center justify-between gap-2">
      <ViewSidebar.Toggle action="expand" presentation="pill" />
      <Show when={!isProjectTab(state.tab)}>
        <div class="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
          <ListHeaderSearch
            wide
            label="Search tasks"
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            focusResults={props.focusSearchResults}
            registerFocus={(focus) => {
              focusSearch = focus;
            }}
          />
          <TasksFilterDrawer />
        </div>
      </Show>
    </div>
  );
}
