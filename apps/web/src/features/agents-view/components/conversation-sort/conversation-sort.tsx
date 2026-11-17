import {
  type ListControlOption,
  ListSortDropdown,
} from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import PencilIcon from '@icon/system/regular/pencil-simple.svg';
import type { ConversationSort } from '../../core/conversation-list';

const SORT_OPTIONS: ListControlOption<ConversationSort>[] = [
  {
    id: 'updated',
    get label() {
      return t('viewMenus.sortLastUpdated');
    },
    icon: () => <PencilIcon class="size-3.5" />,
  },
  {
    id: 'created',
    get label() {
      return t('viewMenus.sortDateCreated');
    },
    icon: () => <CalendarIcon class="size-3.5" />,
  },
];

export function ConversationSortControl(props: {
  value: ConversationSort;
  onChange: (value: ConversationSort) => void;
}) {
  return (
    <ListSortDropdown
      label={t('agentWork.sortConversations')}
      value={props.value}
      onChange={props.onChange}
      options={SORT_OPTIONS}
      size="icon-xs"
      class="size-(--sidebar-control-size)"
    />
  );
}
