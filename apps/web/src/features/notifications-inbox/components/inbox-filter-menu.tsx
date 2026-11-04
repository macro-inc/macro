import { ListFilterDropdown } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { INBOX_CATEGORIES, type InboxCategory } from '../core/inbox-filters';
import { INBOX_FILTER_GROUPS } from './inbox-filter-groups';

/**
 * Filter notifications by kind. Kinds are checkboxes that start checked;
 * unchecking hides that kind.
 */
export function InboxFilterMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isShown: (category: InboxCategory) => boolean;
  activeCount: number;
  onShownChange: (category: InboxCategory, shown: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ListFilterDropdown
      label={t('notificationsInbox.filter')}
      groups={INBOX_FILTER_GROUPS}
      open={props.open}
      onOpenChange={props.onOpenChange}
      activeCount={props.activeCount}
      isSelected={(_group, option) => props.isShown(option)}
      isGroupActive={() =>
        INBOX_CATEGORIES.some((category) => !props.isShown(category))
      }
      onSelectionChange={(_group, option, selected) =>
        props.onShownChange(option, selected)
      }
      onClear={props.onReset}
      clearLabel={t('notificationsInbox.resetFilters')}
    />
  );
}
