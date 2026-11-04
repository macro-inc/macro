import {
  homeClock,
  homeDateBucket,
} from '@app/features/home/queries/home-date-buckets';
import { t } from '@app/lib/i18n';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { NotificationInboxRow } from '../context/notifications-inbox-context';

/** A divider naming when the rows below it arrived, in Home's sections. */
type InboxDateHeaderItem = {
  type: 'date_header';
  id: string;
  bucket: { key: string; label: string };
};

/**
 * A row's place in the list, one object per row id. The virtual list keys items
 * by object and a live change replaces a row's data, so the place stays and the
 * card reads the row's latest data by id: nothing remounts as rows change.
 */
type InboxRowItem = { type: 'row'; id: string };

export type InboxListItem = InboxRowItem | InboxDateHeaderItem;

export const isInboxRow = (item: InboxListItem): item is InboxRowItem =>
  item.type === 'row';

export const dateHeaderLabel = (header: InboxDateHeaderItem) =>
  match(header.bucket.key)
    .with('last-few-minutes', () => t('notificationsInbox.dateLastFewMinutes'))
    .with('last-hour', () => t('notificationsInbox.dateLastHour'))
    .with('this-evening', () => t('notificationsInbox.dateThisEvening'))
    .with('this-afternoon', () => t('notificationsInbox.dateThisAfternoon'))
    .with('this-morning', () => t('notificationsInbox.dateThisMorning'))
    .with('earlier-today', () => t('notificationsInbox.dateEarlierToday'))
    .with('yesterday', () => t('notificationsInbox.dateYesterday'))
    .with('last-7-days', () => t('notificationsInbox.dateLast7Days'))
    .with('earlier-this-month', () =>
      t('notificationsInbox.dateEarlierThisMonth')
    )
    .with('last-month', () => t('notificationsInbox.dateLastMonth'))
    .with('older', () => t('notificationsInbox.dateOlder'))
    // A section Home adds later keeps its own name until it's translated here.
    .otherwise(() => header.bucket.label);

/**
 * A place for each row, with a divider above each date section. Rows arrive
 * newest first, so a section is one run of rows. Dividers are derived from the
 * rows shown, so a section whose rows are filtered out or done has none.
 */
export function createInboxListItems(
  rows: Accessor<readonly NotificationInboxRow[]>
): Accessor<readonly InboxListItem[]> {
  const [now, setNow] = createSignal(homeClock());
  onMount(() => {
    const timer = setInterval(() => setNow(homeClock()), 30_000);
    onCleanup(() => clearInterval(timer));
  });

  // The virtual list keys items by object, so each section keeps one divider
  // and nothing remounts as the clock ticks.
  const headers = new Map<string, InboxDateHeaderItem>();
  const headerFor = (bucket: InboxDateHeaderItem['bucket']) => {
    const existing = headers.get(bucket.key);
    if (existing) return existing;
    const header: InboxDateHeaderItem = {
      type: 'date_header',
      id: `date-header:${bucket.key}`,
      bucket,
    };
    headers.set(bucket.key, header);
    return header;
  };

  let places = new Map<string, InboxRowItem>();

  return createMemo(() => {
    const reference = new Date(now());
    const items: InboxListItem[] = [];
    const shown = new Map<string, InboxRowItem>();
    let section: string | undefined;
    for (const row of rows()) {
      const bucket = homeDateBucket(row.latestAt, reference);
      if (bucket.key !== section) {
        items.push(headerFor(bucket));
        section = bucket.key;
      }
      const place = places.get(row.id) ?? { type: 'row', id: row.id };
      shown.set(row.id, place);
      items.push(place);
    }
    places = shown;
    return items;
  });
}
