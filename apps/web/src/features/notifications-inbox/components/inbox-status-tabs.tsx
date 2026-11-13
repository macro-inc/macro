import { t } from '@app/lib/i18n';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { Button, Tabs } from '@ui';
import type { JSX } from 'solid-js';
import type { InboxLane, InboxStatus } from '../core/inbox-filters';

const statusOptions = () => [
  { value: 'all' as const, label: t('notificationsInbox.statusAll') },
  { value: 'unread' as const, label: t('notificationsInbox.statusUnread') },
];

const laneOptions = () => [
  { value: 'signal' as const, label: t('notificationsInbox.laneSignal') },
  { value: 'noise' as const, label: t('notificationsInbox.laneNoise') },
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

/** Signal and Noise, as the side panel's view tabs. */
export function InboxLaneTabs(props: {
  lane: InboxLane;
  onChange: (lane: InboxLane) => void;
}) {
  return (
    <Tabs
      aria-label={t('notificationsInbox.lane')}
      fullWidth
      options={laneOptions()}
      value={props.lane}
      onChange={props.onChange}
    />
  );
}

/**
 * Only unread rows, as a header toggle. It takes over from the Unread tab
 * once the tabs are lanes.
 */
export function InboxUnreadToggle(props: {
  unreadOnly: boolean;
  onChange: (unreadOnly: boolean) => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={props.unreadOnly}
      tooltip={t('notificationsInbox.unreadOnly')}
      onClick={() => props.onChange(!props.unreadOnly)}
    >
      {t('notificationsInbox.statusUnread')}
    </Button>
  );
}

function InboxPills<T extends string>(props: {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  leading: JSX.Element;
}) {
  return (
    <div class="h-10 min-w-0 flex-1">
      <PillTabs
        scrollable
        class="-ml-(--mobile-chrome-gutter) w-[calc(100%+2*var(--mobile-chrome-gutter))] max-w-none flex-none"
        contentClass="px-(--mobile-chrome-gutter)"
        leading={props.leading}
        items={props.items}
        value={props.value}
        onChange={props.onChange}
      />
    </div>
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
    <InboxPills
      items={statusOptions()}
      value={props.status}
      onChange={props.onChange}
      leading={props.leading}
    />
  );
}

/** Signal and Noise on touch. */
export function InboxLanePills(props: {
  lane: InboxLane;
  onChange: (lane: InboxLane) => void;
  /** The control ahead of the pills: the filter drawer. */
  leading: JSX.Element;
}) {
  return (
    <InboxPills
      items={laneOptions()}
      value={props.lane}
      onChange={props.onChange}
      leading={props.leading}
    />
  );
}
