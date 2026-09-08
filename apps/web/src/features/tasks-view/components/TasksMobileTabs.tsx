import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { TASK_TABS, type TaskTabItem } from '../constants';
import { useTasksView } from '../tasks-view-context';
import type { TaskTab } from '../types';
import { TasksFilterDrawer } from './TasksFilterDrawer';

const toPill = (tab: TaskTabItem): PillTabItem<TaskTab> => ({
  value: tab.id,
  label: tab.label,
});

export function TasksMobileTabs() {
  const { state, setTab } = useTasksView();
  const items = (): PillTabItem<TaskTab>[] => TASK_TABS.map(toPill);

  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        leading={<TasksFilterDrawer />}
        items={items()}
        value={state.tab}
        onChange={setTab}
      />
    </div>
  );
}
