import { t } from '@app/lib/i18n';
import { Tabs } from '@ui';
import type { InboxStatus } from '../core/inbox-filters';

/** Switch the list between every notification and the unread ones. */
export function InboxStatusTabs(props: {
  status: InboxStatus;
  onChange: (status: InboxStatus) => void;
  fullWidth?: boolean;
}) {
  return (
    <Tabs
      aria-label={t('notificationsInbox.status')}
      fullWidth={props.fullWidth}
      options={[
        { value: 'all', label: t('notificationsInbox.statusAll') },
        { value: 'unread', label: t('notificationsInbox.statusUnread') },
      ]}
      value={props.status}
      onChange={props.onChange}
    />
  );
}
