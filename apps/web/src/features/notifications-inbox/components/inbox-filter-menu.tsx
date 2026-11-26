import { ListFilterDropdown } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import type { InboxCategory } from '../core/inbox-filters';
import { INBOX_FILTER_GROUPS } from './inbox-filter-groups';

/** Select kinds to narrow the feed; no selection includes every kind. */
export function InboxFilterMenu(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSelected: (category: InboxCategory) => boolean;
  activeCount: number;
  onSelectedChange: (category: InboxCategory, selected: boolean) => void;
  onReset: () => void;
}) {
  return (
    <ListFilterDropdown
      size={props.activeCount ? 'xs' : 'icon-xs'}
      label={t('notificationsInbox.filter')}
      groups={INBOX_FILTER_GROUPS}
      open={props.open}
      onOpenChange={props.onOpenChange}
      activeCount={props.activeCount}
      isSelected={(_group, option) => props.isSelected(option)}
      isGroupActive={() => props.activeCount > 0}
      onSelectionChange={(_group, option, selected) =>
        props.onSelectedChange(option, selected)
      }
      onClear={props.onReset}
      clearLabel={t('notificationsInbox.resetFilters')}
    />
  );
}
