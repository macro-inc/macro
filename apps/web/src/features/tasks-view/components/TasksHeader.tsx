import {
  SearchBar,
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { SidebarCreateButton } from '@app/components/view-shell/SidebarCreateButton';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { TASK_TABS } from '../constants';
import { useTasksView } from '../tasks-view-context';
import { TasksControls } from './TasksControls';
import { TasksMobileTabs } from './TasksMobileTabs';

export type TasksHeaderProps = {
  /** Restores list focus when Escape leaves the search field. */
  onSearchEscape?: () => void;
};

export function TaskViewBreadcrumbItem() {
  const { state } = useTasksView();
  const tabTitle = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  return (
    <ViewBreadcrumbs.Item
      value="tasks-view"
      metadata={{ type: 'tasks' }}
      order={0}
    >
      {(item) => (
        <ViewBreadcrumbs.ReturnButton
          isActive={item.isActive()}
          onClick={item.onSelect}
          tooltip={tabTitle()}
        >
          <span class="truncate">{tabTitle()}</span>
        </ViewBreadcrumbs.ReturnButton>
      )}
    </ViewBreadcrumbs.Item>
  );
}

export function TasksTopBar() {
  return (
    <ViewShell.TopBar>
      <h1 class="hidden min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:block">
        Tasks
      </h1>
      <ViewBreadcrumbs.Outlet
        class="@max-[720px]/view-shell:hidden"
        aria-label="Task location"
      />
    </ViewShell.TopBar>
  );
}

export function TasksHeader(props: TasksHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const { state, setState } = useTasksView();
  let searchInput: HTMLInputElement | undefined;
  const selectedTabLabel = () =>
    TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search tasks',
      run: () => {
        searchInput?.focus();
        searchInput?.select();
        return true;
      },
    },
  });

  const createTask = () => {
    layout.popoverSplit({ type: 'component', id: 'task-compose' });
  };

  return (
    <div class="flex min-w-0 flex-col @max-[720px]/view-shell:gap-3">
      <Show
        when={isTouchDevice()}
        fallback={
          <>
            <div class="hidden h-8 min-w-0 items-center @max-[720px]/view-shell:flex">
              <h1 class="min-w-0 truncate text-xl font-semibold tracking-[-0.03em] text-ink">
                {selectedTabLabel()}
              </h1>
              <div class="ml-auto shrink-0">
                <SidebarCreateButton label="New" onCreate={createTask} />
              </div>
            </div>

            <div class="flex min-w-0 items-center justify-between gap-3">
              <SearchBar
                ref={(element) => (searchInput = element)}
                label="Search tasks"
                value={state.search}
                hotkey="cmd+f"
                onValueChange={(search) => setState('search', search)}
                onEscape={props.onSearchEscape}
                placeholder="Search tasks"
                class="max-w-md flex-1"
              />
              <TasksControls />
            </div>
          </>
        }
      >
        <TasksMobileTabs />
      </Show>
    </div>
  );
}
