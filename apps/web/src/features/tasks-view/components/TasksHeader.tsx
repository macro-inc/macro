import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewShell,
  ViewSwitchTrigger,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { useProjectSavedViews } from '@app/features/projects/context/project-saved-views-context';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import BookmarkIcon from '@phosphor/bookmark-simple.svg';
import { Show } from 'solid-js';
import { TASK_TABS } from '../constants';
import { taskSavedViewTitle } from '../primitives/create-task-saved-view-draft';
import { TasksCreateAction } from '../tasks-create-action';
import { useTasksView } from '../tasks-view-context';
import {
  TaskSavedViewActions,
  TaskSavedViewMenu,
  TaskSaveViewButton,
} from '../views/task-saved-views';
import { TasksControls } from './TasksControls';
import { TasksMobileTabs } from './TasksMobileTabs';

export type TasksHeaderProps = {
  /** Restores list focus when Escape leaves the search field. */
  onSearchEscape?: () => void;
};

export function TaskViewBreadcrumbItem() {
  const { state, savedViews } = useTasksView();
  const projectViews = useProjectSavedViews();
  const projectSavedView = () =>
    projectViews?.active() ? projectViews.draft.view() : undefined;
  const savedViewActive = () =>
    state.savedViewActive || projectSavedView()?.kind === 'saved';
  const tabTitle = () => {
    const projectView = projectSavedView();
    if (projectView?.kind === 'saved') return projectView.record.name;
    if (projectView?.kind === 'new') return 'New view';
    if (state.savedViewActive && savedViews)
      return taskSavedViewTitle(savedViews.view());
    return TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks';
  };

  return (
    <ViewBreadcrumbs.Item
      value="tasks-view"
      metadata={{ type: 'tasks' }}
      order={0}
    >
      {(item) => {
        const label = () => (
          <>
            <Show when={savedViewActive()}>
              <BookmarkIcon class="size-4 shrink-0" aria-hidden="true" />
            </Show>
            <span class="truncate">{tabTitle()}</span>
          </>
        );
        const button = () => (
          <ViewBreadcrumbs.ReturnButton
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={tabTitle()}
            class="gap-2"
          >
            {label()}
          </ViewBreadcrumbs.ReturnButton>
        );
        // At the list itself the name switches views; deeper, it returns here.
        return (
          <Show when={item.isActive()} fallback={button()}>
            <ViewSwitchTrigger fallback={button()}>{label()}</ViewSwitchTrigger>
          </Show>
        );
      }}
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
          title={
            <div class="flex min-w-0 items-center gap-1">
              <ViewBreadcrumbs.Outlet aria-label="Task location" />
              <TaskSavedViewMenu />
            </div>
          }
        >
          <TaskSaveViewButton />
          <TaskSavedViewActions />
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
        <div class="flex min-w-0 flex-col">
          <TasksMobileTabs />
        </div>
      </ViewShell.Header>
    </Show>
  );
}
