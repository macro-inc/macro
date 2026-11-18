import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewSwitchTrigger,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
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

export type TasksHeaderProps = {
  /** Moves the keyboard from the search field into the list. */
  focusSearchResults?: () => void;
};

export function TaskViewBreadcrumbItem() {
  const { state, savedViews } = useTasksView();
  const tabTitle = () =>
    state.savedViewActive && savedViews
      ? taskSavedViewTitle(savedViews.view())
      : (TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? 'Tasks');

  return (
    <ViewBreadcrumbs.Item
      value="tasks-view"
      metadata={{ type: 'tasks' }}
      order={0}
    >
      {(item) => {
        const label = () => (
          <>
            <Show when={state.savedViewActive}>
              <BookmarkIcon class="size-4 shrink-0" aria-hidden="true" />
            </Show>
            <span class="truncate">{tabTitle()}</span>
          </>
        );
        // A compact (phone) bar keeps its room for the open entity's name, so
        // the way back is an arrow; the view's name stays its accessible name.
        const button = () => (
          <ViewBreadcrumbs.ReturnButton
            isActive={item.isActive()}
            onClick={item.onSelect}
            tooltip={tabTitle()}
            class="gap-2"
          >
            <span
              data-compact-back
              aria-hidden="true"
              class="hidden group-data-[compact]/location:flex"
            >
              <ArrowLeftIcon class="size-4 shrink-0" />
            </span>
            <span class="flex min-w-0 items-center gap-2 group-data-[compact]/location:sr-only">
              {label()}
            </span>
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
  const { state, setState } = useTasksView();
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
    <Show when={!isTouchDevice()}>
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
        <TasksCreateAction presentation="toolbar" />
        <ListHeaderSearch
          label="Search tasks"
          value={state.search}
          onValueChange={(search) => setState('search', search)}
          focusResults={props.focusSearchResults}
          registerFocus={(focus) => {
            focusSearch = focus;
          }}
        />
      </ListHeader>
    </Show>
  );
}
