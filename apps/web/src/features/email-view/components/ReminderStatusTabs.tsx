import { TabsInset } from '@core/component/TabsInset';
import { REMINDER_FILTER_GROUPS } from '../filters/email-facets';
import { useEmailFilters } from '../filters/use-email-filters';
import { REMINDER_STATUS_GROUP_ID } from '../queries/reminder-query';

const STATUS_GROUP = REMINDER_FILTER_GROUPS[0]!;
const STATUS_TABS = STATUS_GROUP.options.map((option) => ({
  value: option.id,
  label: option.label,
}));

/**
 * The Reminders tab's status switch, in the header where the other tabs keep
 * their filter menu. Same selection as that menu's Status group — the mobile
 * drawer shows it as radios — so the two can't disagree.
 */
export function ReminderStatusTabs() {
  const filters = useEmailFilters();
  const value = () =>
    STATUS_TABS.find((tab) => filters.isSelected(STATUS_GROUP.id, tab.value))
      ?.value ?? STATUS_GROUP.defaultOptionId;

  return (
    <TabsInset
      aria-label="Reminder status"
      list={STATUS_TABS}
      value={value()}
      defaultValue={STATUS_GROUP.defaultOptionId}
      onChange={(next) =>
        filters.setSelected(REMINDER_STATUS_GROUP_ID, next, true)
      }
    />
  );
}
