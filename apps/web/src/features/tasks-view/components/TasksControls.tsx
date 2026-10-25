import {
  ListFilterDropdown,
  ListGroupDropdown,
  ListSortDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import GanttIcon from '@phosphor/chart-bar-horizontal.svg';
import BoardIcon from '@phosphor/kanban.svg';
import ListIcon from '@phosphor/list-bullets.svg';
import { Button } from '@ui';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, Show } from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { TASK_BOARD_GROUP_OPTIONS } from '../core/task-board';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';
import { TASKS_TOUR } from '../tour';
import { TasksFilterDrawer } from './TasksFilterDrawer';

export function TasksControls() {
  return (
    <Show when={!isTouchDevice()} fallback={<TasksFilterDrawer />}>
      <DesktopTasksControls />
    </Show>
  );
}

function DesktopTasksControls() {
  const panel = useSplitPanelOrThrow();
  const { state, setPrimarySort, setState, projectsEnabled, ganttEnabled } =
    useTasksView();
  const filters = useTaskFilters();
  const [openMenu, setOpenMenu] = createSignal<'filters' | 'sort'>();
  let filterTrigger: HTMLButtonElement | undefined;
  let sortTrigger: HTMLButtonElement | undefined;

  const handleMenuOpenChange =
    (menu: 'filters' | 'sort') => (open: boolean) => {
      setOpenMenu((current) => {
        if (open) return menu;
        return current === menu ? undefined : current;
      });
    };

  useViewControlHotkeys({
    scopeId: panel.splitHotkeyScope,
    enabled: panel.isPanelActive,
    filter: {
      description: 'Filter tasks',
      run: () => {
        if (!filterTrigger) return false;

        setOpenMenu('filters');
        return true;
      },
    },
    sort: {
      description: 'Sort tasks',
      run: () => {
        if (!sortTrigger) return false;

        setOpenMenu('sort');
        return true;
      },
    },
  });

  const primarySort = () => state.sort[0]?.id ?? 'updated_at';
  const isBoardSearch = () => state.layout === 'board' && !!state.search.trim();

  const groupOptions = () => {
    if (state.layout !== 'board') {
      return TASK_GROUP_OPTIONS;
    }

    return TASK_BOARD_GROUP_OPTIONS.filter((option) => {
      return option.id !== 'project' || projectsEnabled();
    });
  };

  return (
    <>
      <HeaderActionGroup label="Task filters">
        <div class="shrink-0" ref={tourTarget(TASKS_TOUR.filter)}>
          <ListFilterDropdown
            label="Filter tasks"
            activeCount={filters.activeCount()}
            groups={filters.groups()}
            open={openMenu() === 'filters'}
            onOpenChange={handleMenuOpenChange('filters')}
            triggerRef={(element) => (filterTrigger = element)}
            isSelected={filters.isSelected}
            onSelectionChange={filters.setSelected}
            onClear={filters.clear}
            aiFilter={{
              placeholder: 'Filter with AI…',
              onSubmit: filters.applyDescription,
            }}
          />
        </div>
      </HeaderActionGroup>
      <HeaderActionGroup label="Task layout">
        <Button
          variant="ghost"
          size="icon-md"
          label="List"
          aria-pressed={state.layout === 'list'}
          onClick={() => setState('layout', 'list')}
        >
          <ListIcon class="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-md"
          label="Board"
          aria-pressed={state.layout === 'board'}
          onClick={() => setState('layout', 'board')}
        >
          <BoardIcon class="size-4" />
        </Button>
        <Show when={ganttEnabled()}>
          <Button
            variant="ghost"
            size="icon-md"
            label="Gantt"
            aria-pressed={state.layout === 'gantt'}
            onClick={() => setState('layout', 'gantt')}
          >
            <GanttIcon class="size-4" />
          </Button>
        </Show>
      </HeaderActionGroup>
      <HeaderActionGroup label="Task view options">
        <Show
          when={!isBoardSearch()}
          fallback={
            <span
              class="text-xs text-ink-muted"
              title="Search results are ranked by relevance. Clear search to sort the board."
            >
              Relevance
            </span>
          }
        >
          <ListSortDropdown
            label="Sort tasks"
            value={primarySort()}
            options={TASK_SORT_OPTIONS}
            open={openMenu() === 'sort'}
            onChange={setPrimarySort}
            onOpenChange={handleMenuOpenChange('sort')}
            triggerRef={(element) => (sortTrigger = element)}
          />
        </Show>
        <ListGroupDropdown
          label="Group by"
          value={state.groupBy}
          options={groupOptions()}
          onChange={(groupBy) => setState('groupBy', groupBy)}
        />
      </HeaderActionGroup>
    </>
  );
}
