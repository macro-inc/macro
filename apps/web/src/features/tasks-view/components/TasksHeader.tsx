import {
  SearchBar,
  SidebarActionRow,
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
} from '@app/components/view-shell';
import { useSidebarSearchFocus } from '@app/components/view-shell/SidebarActionRow';
import { SidebarCreateAction } from '@app/components/view-shell/SidebarCreateAction';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import TaskIcon from '@icon/system/regular/check-square.svg';
import ProjectIcon from '@icon/system/regular/folder.svg';
import { Dropdown } from '@ui';
import { type ParentProps, Show } from 'solid-js';
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

export function TasksTopBar(props: ParentProps = {}) {
  return (
    <ViewShell.TopBar
      controls={
        <div class="flex min-w-0 items-center gap-2">{props.children}</div>
      }
      workspaceActions
      class="h-12 gap-3 px-4 not-touch:pl-4 touch:flex touch:mt-[var(--safe-top,0px)]"
    >
      <h1 class="hidden min-w-0 truncate text-sm font-semibold tracking-[-0.03em] text-ink @max-[720px]/view-shell:block">
        Tasks
      </h1>
      <ViewBreadcrumbs.Outlet
        class="min-w-0 @max-[720px]/view-shell:hidden"
        aria-label="Task location"
      />
    </ViewShell.TopBar>
  );
}

export function TasksHeader() {
  return (
    <>
      <TasksTopBar>
        <Show when={!isTouchDevice()}>
          <TasksControls />
        </Show>
      </TasksTopBar>
      <Show when={isTouchDevice()}>
        <ViewShell.Header class="py-2 touch:pt-2">
          <TasksMobileTabs />
        </ViewShell.Header>
      </Show>
    </>
  );
}

export function TasksPrimaryActions(props: TasksHeaderProps) {
  const panel = useSplitPanelOrThrow();
  const layout = useSplitLayout();
  const { state, setState, closeTask, projectsEnabled } = useTasksView();
  let searchInput: HTMLInputElement | undefined;
  const focusSearch = useSidebarSearchFocus(() => searchInput);

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: () => panel.isPanelActive() && !isTouchDevice(),
    search: {
      description: 'Search tasks',
      run: () => {
        closeTask();
        focusSearch();
        return true;
      },
    },
  });

  const createTask = () => {
    layout.popoverSplit({ type: 'component', id: 'task-compose' });
  };

  return (
    <SidebarActionRow
      title="Tasks"
      onSearch={() => {
        closeTask();
        focusSearch();
      }}
      search={
        <SearchBar
          ref={(element) => (searchInput = element)}
          onEscape={props.onSearchEscape}
          label="Search tasks"
          value={state.search}
          placeholder="Search tasks"
          onValueChange={(search) => {
            setState('search', search);
            closeTask();
          }}
        />
      }
      sidebarCreate={() => (
        <Show
          when={projectsEnabled()}
          fallback={
            <SidebarCreateAction aria-label="New task" onClick={createTask}>
              New
            </SidebarCreateAction>
          }
        >
          <Dropdown placement="bottom-start">
            <Dropdown.Trigger
              as={SidebarCreateAction}
              aria-label="New task or project"
            >
              New
            </Dropdown.Trigger>
            <Dropdown.Content>
              <Dropdown.Item onSelect={createTask}>
                <TaskIcon class="size-4" />
                New Task
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() =>
                  layout.popoverSplit({
                    type: 'component',
                    id: 'project-compose',
                  })
                }
              >
                <ProjectIcon class="size-4" />
                New Project
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown>
        </Show>
      )}
      create={() => (
        <SidebarCreateAction aria-label="New task" onClick={createTask}>
          New
        </SidebarCreateAction>
      )}
    />
  );
}
