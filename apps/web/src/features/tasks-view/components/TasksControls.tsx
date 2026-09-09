import {
  ListFilterDropdown,
  ListGroupDropdown,
  ListSortDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { PreviewButton } from '@components/app/split-layout/components/PreviewButton';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { createSignal, Show } from 'solid-js';
import { TASK_GROUP_OPTIONS, TASK_SORT_OPTIONS } from '../constants';
import { useTaskFilters } from '../filters/use-task-filters';
import { useTasksView } from '../tasks-view-context';

export function TasksControls() {
  const panel = useSplitPanelOrThrow();
  const { state, setPrimarySort, setState } = useTasksView();
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

  return (
    <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 @max-[720px]/view-shell:gap-1">
      <ListSortDropdown
        label="Sort tasks"
        value={primarySort()}
        options={TASK_SORT_OPTIONS}
        open={openMenu() === 'sort'}
        onChange={setPrimarySort}
        onOpenChange={handleMenuOpenChange('sort')}
        triggerRef={(element) => (sortTrigger = element)}
      />
      <ListGroupDropdown
        label="Group tasks"
        value={state.groupBy}
        options={TASK_GROUP_OPTIONS}
        onChange={(groupBy) => setState('groupBy', groupBy)}
      />
      <div class="relative shrink-0">
        <ListFilterDropdown
          label="Filter tasks"
          groups={filters.groups()}
          open={openMenu() === 'filters'}
          onOpenChange={handleMenuOpenChange('filters')}
          triggerRef={(element) => (filterTrigger = element)}
          isSelected={filters.isSelected}
          onSelectionChange={filters.setSelected}
          onClear={filters.clear}
        />
        <Show when={filters.activeCount() > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {filters.activeCount()}
          </span>
        </Show>
      </div>
      <PreviewButton iconOnly class="rounded-lg" />
    </div>
  );
}
