import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { TASK_TABS } from '../constants';
import { TasksCreateAction } from '../tasks-create-action';
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

export function TasksHeader(props: TasksHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const { state, setState, projectsEnabled } = useTasksView();
  let focusSearch: (() => void) | undefined;
  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search tasks',
      run: () => {
        focusSearch?.();
        return true;
      },
    },
  });

  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <ListHeader
          title={<ViewBreadcrumbs.Outlet aria-label="Task location" />}
        >
          <TasksControls />
          <TasksCreateAction
            presentation="toolbar"
            projectsEnabled={projectsEnabled()}
          />
          <ListHeaderSearch
            label="Search tasks"
            value={state.search}
            onValueChange={(search) => setState('search', search)}
            onEscape={props.onSearchEscape}
            registerFocus={(focus) => {
              focusSearch = focus;
            }}
          />
        </ListHeader>
      }
    >
      <ViewShell.Header>
        <div class="flex min-w-0 flex-col @max-[720px]/view-shell:gap-3">
          <TasksMobileTabs />
        </div>
      </ViewShell.Header>
    </Show>
  );
}
