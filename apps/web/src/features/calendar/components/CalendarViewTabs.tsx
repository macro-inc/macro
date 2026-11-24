import { t } from '@app/lib/i18n';
import { Tabs } from '@ui';
import { CALENDAR_PERIODS } from '../core/periods';
import type { CalendarPeriodView } from '../types';
import { calendarPeriodLabel } from '../utils/calendar-label';

export type CalendarViewTabsProps = {
  value: CalendarPeriodView;
  onChange: (value: CalendarPeriodView) => void;
};

/**
 * Calendar view selection belongs beside the title, outside action groups.
 * @do Let the workspace own the selected period and navigation.
 * @dont Put view tabs inside an action group.
 */
export function CalendarViewTabs(props: CalendarViewTabsProps) {
  const options = () =>
    CALENDAR_PERIODS.map((value) => ({
      value,
      label: calendarPeriodLabel(value),
    }));
  return (
    <Tabs
      aria-label={t('calendar.viewLabel')}
      options={options()}
      value={props.value}
      onChange={props.onChange}
      size="md"
    />
  );
}
