import { t } from '@app/lib/i18n';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { Tabs } from '@ui';
import type { JSX } from 'solid-js';
import type { InboxStatus } from '../core/inbox-filters';

const statusOptions = () => [
  { value: 'all' as const, label: t('notificationsInbox.statusAll') },
  { value: 'unread' as const, label: t('notificationsInbox.statusUnread') },
];

/** All and Unread, as the side panel's view tabs. */
export function InboxStatusTabs(props: {
  status: InboxStatus;
  onChange: (status: InboxStatus) => void;
}) {
  return (
    <Tabs
      aria-label={t('notificationsInbox.status')}
      fullWidth
      options={statusOptions()}
      value={props.status}
      onChange={props.onChange}
    />
  );
}

/** All and Unread on touch: the pills every view's floating header uses. */
export function InboxStatusPills(props: {
  status: InboxStatus;
  onChange: (status: InboxStatus) => void;
  /** The control ahead of the pills: the filter drawer. */
  leading: JSX.Element;
}) {
  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={props.leading}
        items={statusOptions()}
        value={props.status}
        onChange={props.onChange}
      />
    </div>
  );
}
