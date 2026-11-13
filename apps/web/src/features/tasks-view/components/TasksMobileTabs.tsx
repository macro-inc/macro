import { PillTabs } from '@components/app/mobile/PillTabs';
import type { JSX } from 'solid-js';
import { BUILT_IN_TASK_TABS } from '../constants';
import { useTasksView } from '../tasks-view-context';
import { TaskSavedViewsPicker } from '../views/task-saved-views';
import { TasksFilterDrawer } from './TasksFilterDrawer';

export function TasksMobileTabs(props: { leading?: JSX.Element }) {
  const { state, setTab } = useTasksView();
  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={
          <>
            {props.leading ?? <TasksFilterDrawer />}
            <TaskSavedViewsPicker />
          </>
        }
        items={BUILT_IN_TASK_TABS.map((tab) => ({
          value: tab.id,
          label: tab.label,
        }))}
        value={state.savedViewActive ? undefined : state.tab}
        onChange={setTab}
      />
    </div>
  );
}
