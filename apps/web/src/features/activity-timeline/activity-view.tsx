import {
  defineQueryFilters,
  type Query,
} from '@app/features/next-soup/filters/filter-store';
import { ENABLE_SNIPPETS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import type { TimelineRow } from './collapse';
import { EntityEventFeedRow } from './entity-event-row';
import { mapMyActivityEntity, mapSharedEmailEntity } from './entity-events';
import {
  createNotificationTimelineFeed,
  createSoupTimelineFeed,
} from './feeds';
import { mergeTimelineFeeds } from './merge-feeds';
import { NotificationFeedRow } from './notification-feed-row';
import { TimelinePane } from './timeline-view';
import { useChannelLookup } from './use-channel-lookup';

/**
 * Server filters for the user's own actions: messages/threads they took part
 * in (per-message soup rows), documents/tasks they created or edited, agent
 * chats and folders they own, and calls they attended — plus, via the email
 * view, the emails they sent. Drafts live in a separate email view, so they
 * are a second query merged in below.
 */
const getMyActionsQuery = (userId: string): Query =>
  defineQueryFilters({
    include: {
      channelThreadParticipantId: [userId],
      documentOwnerId: [userId],
      isEmailAttachment: false,
      chatOwnerId: [userId],
      folderOwnerId: [userId],
      callAttended: true,
    },
    exclude: ENABLE_SNIPPETS() ? {} : { subType: ['snippet'] },
    emailView: 'sent',
  });

const getMyDraftsQuery = (): Query =>
  defineQueryFilters({ emailView: 'drafts' });

/**
 * "Things I did": the user's own recent actions at event granularity —
 * messages sent, threads replied to, emails sent, drafts started, documents
 * created/edited, tasks and folders created, agent sessions, and calls
 * attended.
 */
function MyActivityPane() {
  const userId = useUserId();
  const resolveChannel = useChannelLookup();

  const feed = mergeTimelineFeeds([
    createSoupTimelineFeed({
      query: () => getMyActionsQuery(userId() ?? ''),
      map: (entity) => mapMyActivityEntity(entity, userId()),
      enabled: () => userId() !== undefined,
    }),
    createSoupTimelineFeed({
      query: getMyDraftsQuery,
      map: (entity) => mapMyActivityEntity(entity, userId()),
      enabled: () => userId() !== undefined,
    }),
  ]);

  const renderRow = (row: TimelineRow, connector: boolean) => (
    <EntityEventFeedRow
      row={row}
      resolveChannel={resolveChannel}
      connector={connector}
      ownActions
    />
  );

  return (
    <TimelinePane
      title="Things I did"
      description="Your recent actions, for retracing your steps."
      feed={feed}
      renderRow={renderRow}
      emptyTitle="No activity yet"
      emptyDescription="Messages and emails you send, documents you edit, and tasks you create will appear here."
    />
  );
}

/**
 * "Firehose": everything going on in the team, at event granularity.
 * Notifications supply the per-event records — every channel message (with
 * its text), thread replies, mentions, document comments, task assignments,
 * calls, and GitHub PR events (opened/merged/closed, reviews, comments).
 * CRM-shared email threads are merged in from soup so team email traffic
 * (visibility inherited from CRM permissions) shows up even though it never
 * notifies this user directly.
 */
function FirehosePane() {
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

  const renderRow = (row: TimelineRow, connector: boolean) =>
    row.items[0]!.kind === 'notification' ? (
      <NotificationFeedRow row={row} connector={connector} />
    ) : (
      <EntityEventFeedRow
        row={row}
        resolveChannel={resolveChannel}
        connector={connector}
      />
    );

  return (
    <TimelinePane
      title="Firehose"
      description="Everything happening across your team, as it happens."
      feed={feed}
      renderRow={renderRow}
      emptyTitle="Nothing happening yet"
      emptyDescription="Messages, replies, comments, shared emails, calls, and pull request activity from across your team will appear here."
    />
  );
}

/**
 * The Activity tab: "Things I did" (the user's own action timeline) on the
 * left, the team Firehose on the right, each scrolling independently.
 */
export function ActivityView() {
  return (
    <div class="flex h-full min-h-0 flex-col md:flex-row">
      <div class="min-h-0 min-w-0 flex-1 border-b border-edge-muted md:border-b-0 md:border-r">
        <MyActivityPane />
      </div>
      <div class="min-h-0 min-w-0 flex-1">
        <FirehosePane />
      </div>
    </div>
  );
}
