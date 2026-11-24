import {
  useViewControlHotkeys,
  ViewBreadcrumbs,
  ViewSwitchTrigger,
} from '@app/components/view-shell';
import {
  ListHeader,
  ListHeaderSearch,
} from '@app/components/view-shell/ListHeader';
import { useProjectSavedViews } from '@app/features/projects/context/project-saved-views-context';
import { t } from '@app/lib/i18n';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createLabelCollapse } from '@core/signal/create-label-collapse';
import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { createSignal, Show } from 'solid-js';
import { TASK_TABS } from '../constants';
import { taskSavedViewTitle } from '../primitives/create-task-saved-view-draft';
import { TasksCreateAction } from '../tasks-create-action';
import { useTasksView } from '../tasks-view-context';
import { useTasksTimeView } from '../time-view';
import {
  TaskSavedViewActions,
  TaskSavedViewMenu,
  TaskSaveViewButton,
} from '../views/task-saved-views';
import { TasksControls } from './TasksControls';

/** What the header gives up, in order, when its actions would overflow it. */
const HEADER_COLLAPSE_ORDER = ['layout', 'viewOptions'] as const;

export type TasksHeaderProps = {
  /** Moves the keyboard from the search field into the list. */
  focusSearchResults?: () => void;
};

export function TaskViewBreadcrumbItem() {
  const { state, savedViews } = useTasksView();
  const projectViews = useProjectSavedViews();
  const timeView = useTasksTimeView();
  const projectSavedView = () =>
    projectViews?.active() ? projectViews.draft.view() : undefined;
  const savedViewActive = () =>
    !timeView() &&
    (state.savedViewActive || projectSavedView()?.kind === 'saved');
  const tabTitle = () => {
    const view = timeView();
    if (view === 'week') return t('timeTracking.myWeek');
    if (view === 'team') return t('timeTracking.team');
    const projectView = projectSavedView();
    if (projectView?.kind === 'saved') return projectView.record.name;
    if (projectView?.kind === 'new') return t('viewMenus.newView');
    if (state.savedViewActive && savedViews)
      return taskSavedViewTitle(savedViews.view());
    return (
      TASK_TABS.find((tab) => tab.id === state.tab)?.label ?? t('nav.tasks')
    );
  };
  const appearance = () => {
    const view = projectSavedView() ?? savedViews?.view();
    return view?.kind === 'saved' ? view.record.appearance : undefined;
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
              <EntityIcon
                targetType="saved_view"
                appearance={appearance()}
                size="xs"
              />
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
  // A narrow pane (the desktop window has no minimum width) hides the layout
  // switch, then sort and group, rather than push New and Search past the
  // header's edge. Each comes back once there is room.
  const [actions, setActions] = createSignal<HTMLDivElement>();
  const collapsed = createLabelCollapse(actions, () => HEADER_COLLAPSE_ORDER, {
    watchContent: true,
  });
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
        actionsRef={setActions}
        title={
          <div class="flex min-w-0 items-center gap-1">
            <ViewBreadcrumbs.Outlet aria-label="Task location" />
            <TaskSavedViewMenu />
          </div>
        }
      >
        <TaskSaveViewButton />
        <TaskSavedViewActions />
        <TasksControls
          hideLayout={collapsed('layout')}
          hideViewOptions={collapsed('viewOptions')}
        />
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
