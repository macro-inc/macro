import {
  compareTimelinePositions,
  type TimelinePosition,
} from '@core/util/message-timeline';

export type MessagingTimelineEntry = {
  key: string;
  position: TimelinePosition;
};
type SendIntent = {
  id: string;
  created_at: string;
  channel_id: string;
  message_id?: string | null;
};

export const sendRowKey = (id: string) => `external-send:${id}`;

/** Stable bounded request, including a small overscan around the viewport. */
export function visibleDeliveryIds(
  keys: readonly string[],
  eligible: ReadonlySet<string>,
  known: ReadonlySet<string>,
  range?: { first: string; last: string }
): string[] {
  const first = range ? keys.indexOf(range.first) : -1;
  const last = range ? keys.indexOf(range.last) : -1;
  const start =
    first < 0 ? Math.max(0, keys.length - 50) : Math.max(0, first - 6);
  const end = last < 0 ? keys.length : last + 7;
  return keys
    .slice(start, end)
    .filter((key) => eligible.has(key) && !known.has(key))
    .slice(0, 100)
    .sort();
}

/** Merge attempts into the native oldest-first timeline using its exact ordering. */
export function deliveryTimelineKeys(
  channelId: string,
  entries: readonly MessagingTimelineEntry[],
  sends: readonly SendIntent[],
  includesLatest: boolean
): string[] {
  const nativeIds = new Set(entries.map((entry) => entry.key));
  const first = entries[0]?.position;
  const last = entries.at(-1)?.position;
  const attempts = sends.filter((send) => {
    const position = { id: send.id, createdAt: send.created_at };
    return (
      send.channel_id === channelId &&
      (!send.message_id || !nativeIds.has(send.message_id)) &&
      (!first || compareTimelinePositions(position, first) >= 0) &&
      (includesLatest ||
        (!!last && compareTimelinePositions(position, last) <= 0))
    );
  });
  if (!attempts.length) return entries.map((entry) => entry.key);
  return [
    ...entries,
    ...attempts.map((send) => ({
      key: sendRowKey(send.id),
      position: { id: send.id, createdAt: send.created_at },
    })),
  ]
    .sort((a, b) => compareTimelinePositions(a.position, b.position))
    .map((entry) => entry.key);
}
