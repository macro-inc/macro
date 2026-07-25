import type { TimelineItem } from './timeline-types';

/**
 * A rendered feed row: one timeline item, or a run of consecutive items
 * collapsed together ("You sent 5 messages in #squad"). `ts` is the newest
 * item's timestamp; items are kept newest-first.
 */
export type TimelineRow = {
  key: string;
  ts: number;
  items: TimelineItem[];
};

/**
 * The grouping key for collapsible items. Consecutive items sharing a key
 * fold into one row. Only repeat-noise event shapes collapse — channel
 * messages/replies by the same sender in the same place, and CI check runs
 * on the same PR. Everything else (emails, doc edits, PR reviews, …) stays
 * a row per event since each one carries distinct information.
 */
function collapseKey(item: TimelineItem): string | undefined {
  if (item.kind === 'notification') {
    const notification = item.notification;
    const tag = notification.notification_metadata.tag;
    if (tag === 'channel_message_send' || tag === 'channel_message_reply') {
      return `n:${tag}:${notification.sender_id}:${notification.entity_id}`;
    }
    if (tag === 'github_pr_check_run') {
      return `n:${tag}:${notification.entity_id}`;
    }
    if (tag === 'ai_response') {
      return `n:${tag}:${notification.entity_id}`;
    }
    return undefined;
  }

  if (item.verb === 'sent-message' || item.verb === 'replied-in-thread') {
    return item.entity.type === 'channel_thread'
      ? `e:${item.verb}:${item.entity.channelId}`
      : undefined;
  }
  return undefined;
}

/**
 * Fold consecutive same-key items in a newest-first list into single rows.
 */
export function collapseTimeline(items: TimelineItem[]): TimelineRow[] {
  const rows: (TimelineRow & { collapseKey?: string })[] = [];

  for (const item of items) {
    const key = collapseKey(item);
    const current = rows[rows.length - 1];
    if (key !== undefined && current?.collapseKey === key) {
      current.items.push(item);
      continue;
    }
    rows.push({
      collapseKey: key,
      key: `${item.kind}:${item.id}`,
      ts: item.ts,
      items: [item],
    });
  }

  return rows;
}
