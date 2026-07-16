import { defineQueryFilters } from '@app/features/next-soup/filters/filter-store';
import { NotificationRow } from '@entity/extractors-notification/notification-row';
import { EntityEventRow } from './entity-event-row';
import { mapSharedEmailEntity } from './entity-events';
import {
  createNotificationTimelineFeed,
  createSoupTimelineFeed,
} from './feeds';
import { mergeTimelineFeeds } from './merge-feeds';
import { TimelineView } from './timeline-view';
import { useChannelLookup } from './use-channel-lookup';

/**
 * Firehose: a timeline of everything going on in the team, at event
 * granularity. Notifications supply the per-event records — every channel
 * message (with its text), thread replies, mentions, document comments,
 * task assignments, calls, and GitHub PR events (opened/merged/closed,
 * reviews, comments). CRM-shared email threads are merged in from soup so
 * team email traffic (visibility inherited from CRM permissions) shows up
 * even though it never notifies this user directly.
 */
export function FirehoseView() {
  const resolveChannel = useChannelLookup();

  const feed = mergeTimelineFeeds([
    // The notification stream splits by done state server-side; a timeline
    // is history, so fetch both and merge.
    createNotificationTimelineFeed({}),
    createNotificationTimelineFeed({ done: true }),
    createSoupTimelineFeed({
      query: () =>
        defineQueryFilters({
          include: { emailShared: 'only' },
          emailView: 'all',
        }),
      map: mapSharedEmailEntity,
    }),
  ]);

  return (
    <TimelineView
      title="Firehose"
      description="Everything happening across your team, as it happens."
      feed={feed}
      emptyTitle="Nothing happening yet"
      emptyDescription="Messages, replies, comments, shared emails, calls, and pull request activity from across your team will appear here."
      renderItem={(item) =>
        item.kind === 'notification' ? (
          <NotificationRow
            notification={item.notification}
            variant="compact"
            showMarkDone={false}
          />
        ) : (
          <EntityEventRow item={item} resolveChannel={resolveChannel} />
        )
      }
    />
  );
}
