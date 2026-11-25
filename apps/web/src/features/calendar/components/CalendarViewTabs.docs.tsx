import { defineDoc } from '@app/features/ui-gallery/types';
import { createSignal } from 'solid-js';
import type { CalendarPeriodView } from '../types';
import { CalendarViewTabs } from './CalendarViewTabs';

// #region demo:periods
function CalendarViewTabsDemo() {
  const [period, setPeriod] = createSignal<CalendarPeriodView>('timeGridWeek');
  return <CalendarViewTabs value={period()} onChange={setPeriod} />;
}
// #endregion

export default defineDoc({
  name: 'Calendar view tabs',
  category: 'Navigation',
  description: 'The shared desktop period selector, including Agenda.',
  propTypes: ['CalendarViewTabsProps'],
  demos: [
    {
      id: 'periods',
      title: 'Day, Week, Month, and Agenda',
      render: CalendarViewTabsDemo,
    },
  ],
});
