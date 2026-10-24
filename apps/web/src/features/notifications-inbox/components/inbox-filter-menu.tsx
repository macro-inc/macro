import { ListFilterDropdown } from '@app/components/view-shell';
import {
  INBOX_CATEGORIES,
  type InboxCategory,
  type InboxStatus,
} from '../core/inbox-filters';
import { INBOX_FILTER_GROUPS, isStatusOption } from './inbox-filter-groups';

/**
 * Filter notifications by read state and by kind. Kinds are checkboxes that
 * start checked; unchecking hides that kind.
 */
export function InboxFilterMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InboxStatus;
  isShown: (category: InboxCategory) => boolean;
  activeCount: number;
  onStatusChange: (status: InboxStatus) => void;
  onShownChange: (category: InboxCategory, shown: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ListFilterDropdown
      label="Filter notifications"
      groups={INBOX_FILTER_GROUPS}
      open={props.open}
      onOpenChange={props.onOpenChange}
      activeCount={props.activeCount}
      isSelected={(group, option) =>
        group === 'status'
          ? props.status === option
          : !isStatusOption(option) && props.isShown(option)
      }
      isGroupActive={(group) =>
        group === 'status'
          ? props.status !== 'all'
          : INBOX_CATEGORIES.some((category) => !props.isShown(category))
      }
      onSelectionChange={(group, option, selected) => {
        if (isStatusOption(option)) {
          if (group === 'status') props.onStatusChange(option);
          return;
        }
        props.onShownChange(option, selected);
      }}
      onClear={props.onReset}
      clearLabel="Reset filters"
    />
  );
}
