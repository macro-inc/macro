import {
  ListFilterDropdown,
  useViewControlHotkeys,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { tourTarget } from '@ui/components/Tour';
import { createSignal, Show } from 'solid-js';
import { useTaskFilters } from '../filters/use-task-filters';
import { TASKS_TOUR } from '../tour';
import { TasksFilterDrawer } from './TasksFilterDrawer';
import { TasksViewMenu } from './TasksViewMenu';
import { TaskDueDateRangeDialog } from './task-due-date-range-dialog';

export function TasksControls() {
  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <>
          <TasksFilterDrawer />
          <TasksViewMenu />
        </>
      }
    >
      <DesktopTasksControls />
    </Show>
  );
}

function DesktopTasksControls() {
  const panel = useSplitPanelOrThrow();
  const filters = useTaskFilters();
  const [openMenu, setOpenMenu] = createSignal<'filters' | 'view'>();
  let filterTrigger: HTMLButtonElement | undefined;
  let viewTrigger: HTMLButtonElement | undefined;

  const handleMenuOpenChange =
    (menu: 'filters' | 'view') => (open: boolean) => {
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
      description: 'Task view options',
      run: () => {
        if (!viewTrigger) return false;
        setOpenMenu('view');
        return true;
      },
    },
  });

  return (
    <>
      <HeaderActionGroup label={t('viewMenus.filters')} size="md">
        <div class="shrink-0" ref={tourTarget(TASKS_TOUR.filter)}>
          <ListFilterDropdown
            grouped
            size={filters.activeCount() ? 'md' : 'icon-md'}
            label="Filter tasks"
            activeCount={filters.activeCount()}
            groups={filters.groups()}
            open={openMenu() === 'filters'}
            onOpenChange={handleMenuOpenChange('filters')}
            triggerRef={(element) => (filterTrigger = element)}
            isSelected={filters.isSelected}
            selectedIds={filters.selectedIds}
            onSelectionChange={filters.setSelected}
            onClear={filters.clear}
            aiFilter={{
              placeholder: 'Filter with AI…',
              onSubmit: filters.applyDescription,
            }}
          />
        </div>
      </HeaderActionGroup>
      <HeaderActionGroup label={t('viewMenus.viewOptions')} size="md">
        <TasksViewMenu
          open={openMenu() === 'view'}
          onOpenChange={handleMenuOpenChange('view')}
          triggerRef={(element) => (viewTrigger = element)}
        />
      </HeaderActionGroup>
      <TaskDueDateRangeDialog
        value={filters.customRange()}
        onChange={filters.setCustomRange}
        onApply={filters.applyCustomRange}
      />
    </>
  );
}
