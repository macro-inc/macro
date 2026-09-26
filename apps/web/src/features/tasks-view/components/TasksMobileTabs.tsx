import { reviewsSplitRoute } from '@app/features/reviews-view/route';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useNavigate } from '@app/lib/split-router';
import { type PillTabItem, PillTabs } from '@components/app/mobile/PillTabs';
import { enableTasksReviews } from '@core/constant/featureFlags';
import type { JSX } from 'solid-js';
import { TASK_TABS, type TaskTabItem } from '../constants';
import { useTasksView } from '../tasks-view-context';
import type { TasksTab } from '../types';
import { TasksFilterDrawer } from './TasksFilterDrawer';

const toPill = (tab: TaskTabItem): PillTabItem<TasksTab> => ({
  value: tab.id,
  label: tab.label,
});

export function TasksMobileTabs(props: { leading?: JSX.Element }) {
  const { state, setTab } = useTasksView();
  const navigate = useNavigate();
  const flag = useFeatureFlag(enableTasksReviews);
  const items = (): PillTabItem<TasksTab | 'reviews'>[] => [
    ...(flag().enabled
      ? [{ value: 'reviews' as const, label: 'Reviews' }]
      : []),
    ...TASK_TABS.map(toPill),
  ];

  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={props.leading ?? <TasksFilterDrawer />}
        items={items()}
        value={state.tab}
        onChange={(tab) => {
          if (tab === 'reviews')
            navigate({ route: reviewsSplitRoute, params: {} });
          else setTab(tab);
        }}
      />
    </div>
  );
}
