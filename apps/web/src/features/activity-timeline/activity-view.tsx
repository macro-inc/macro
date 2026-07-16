import {
  defineQueryFilters,
  type Query,
} from '@app/features/next-soup/filters/filter-store';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import type { TabItem } from '@core/component/Tabs';
import { TabsInset } from '@core/component/TabsInset';
import { ENABLE_SNIPPETS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { getTypeNoun } from '@entity/extractors-notification/notification-description-helpers';
import { NotificationRow } from '@entity/extractors-notification/notification-row';
import type { SoupApiItemFilter } from '@queries/soup/items';
import { makePersisted } from '@solid-primitives/storage';
import { createMemo, createSignal, type JSX, Show } from 'solid-js';
import type { TimelineRow } from './collapse';
import { EntityEventRow } from './entity-event-row';
import { mapMyActivityEntity, mapSharedEmailEntity } from './entity-events';
import {
  createNotificationTimelineFeed,
  createSoupTimelineFeed,
} from './feeds';
import { mergeTimelineFeeds } from './merge-feeds';
import { TimelinePane } from './timeline-view';
import { useChannelLookup } from './use-channel-lookup';

/**
 * Server filters for the user's own actions: messages/threads they took part
 * in (per-message soup rows), documents/tasks they created or edited, agent
 * chats and folders they own, and calls they attended — plus, via the email
 * view, the emails they sent. Drafts live in a separate email view, so they
 * are a second query merged in below.
 *
 * Documents are restricted to the types the user authors in Macro (md and
 * canvas, which includes tasks). Ingested files — email-auto-parsed PDFs,
 * attachment uploads, bulk imports — are actions a pipeline took, not the
 * user, and their updatedAt also moves on viewer activity, so they are
 * excluded entirely rather than shown as created/edited.
 */
const getMyActionsQuery = (userId: string): Query =>
  defineQueryFilters({
    include: {
      channelThreadParticipantId: [userId],
      documentOwnerId: [userId],
      fileType: ['md', 'canvas'],
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
 * Websocket-insert gates mirroring the server queries above (the cache layer
 * bypasses the server AST — see `createSoupTimelineFeed.itemFilter`). The
 * document arm mirrors the authorable-types restriction; the mapper drops
 * anything else that slips through.
 */
const myActionsItemFilter: SoupApiItemFilter = (item) =>
  item.tag !== 'document' ||
  item.data.subType?.type === 'task' ||
  item.data.fileType === 'md' ||
  item.data.fileType === 'canvas';

const emailOnlyItemFilter: SoupApiItemFilter = (item) =>
  item.tag === 'emailThread';

/**
 * A notification row (or collapsed run of them). Single notifications render
 * through the standard notification row; runs keep the newest notification's
 * description and swap the content slot for a count summary.
 */
function NotificationTimelineRow(props: { row: TimelineRow }) {
  const notifications = () =>
    props.row.items.flatMap((item) =>
      item.kind === 'notification' ? [item.notification] : []
    );
  const first = () => notifications()[0]!;
  const count = () => notifications().length;

  return (
    <NotificationRow
      notification={first()}
      variant="compact"
      showMarkDone={false}
      content={
        // Leave the slot on the default per-type content for single rows;
        // runs summarize as "5 messages".
        count() > 1 ? (
          <span class="truncate">
            {count()} {getTypeNoun(first().notification_metadata.tag, count())}
          </span>
        ) : undefined
      }
    />
  );
}

/**
 * "Things I did": the user's own recent actions at event granularity —
 * messages sent, threads replied to, emails sent, drafts started, documents
 * created/edited, tasks and folders created, agent sessions, and calls
 * attended.
 */
function MyActivityPane(props: { trailing?: JSX.Element }) {
  const userId = useUserId();
  const resolveChannel = useChannelLookup();

  const feed = mergeTimelineFeeds([
    createSoupTimelineFeed({
      query: () => getMyActionsQuery(userId() ?? ''),
      map: (entity) => mapMyActivityEntity(entity, userId()),
      enabled: () => userId() !== undefined,
      itemFilter: myActionsItemFilter,
    }),
    createSoupTimelineFeed({
      query: getMyDraftsQuery,
      map: (entity) => mapMyActivityEntity(entity, userId()),
      enabled: () => userId() !== undefined,
      itemFilter: emailOnlyItemFilter,
    }),
  ]);

  const renderRow = (row: TimelineRow) => (
    <EntityEventRow row={row} resolveChannel={resolveChannel} />
  );

  return (
    <TimelinePane
      title="Things I did"
      description="Your recent actions, for retracing your steps."
      feed={feed}
      renderRow={renderRow}
      emptyTitle="No activity yet"
      emptyDescription="Messages and emails you send, documents you edit, and tasks you create will appear here."
      trailing={props.trailing}
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
function FirehosePane(props: { trailing?: JSX.Element }) {
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
      itemFilter: emailOnlyItemFilter,
    }),
  ]);

  const renderRow = (row: TimelineRow) =>
    row.items[0]!.kind === 'notification' ? (
      <NotificationTimelineRow row={row} />
    ) : (
      <EntityEventRow row={row} resolveChannel={resolveChannel} />
    );

  return (
    <TimelinePane
      title="Firehose"
      description="Everything happening across your team, as it happens."
      feed={feed}
      renderRow={renderRow}
      emptyTitle="Nothing happening yet"
      emptyDescription="Messages, replies, comments, shared emails, calls, and pull request activity from across your team will appear here."
      trailing={props.trailing}
    />
  );
}

type ActivityTab = 'me' | 'team';

const ACTIVITY_TABS: TabItem[] = [
  { value: 'me', label: 'Me' },
  { value: 'team', label: 'Team' },
];

/**
 * Minimum split width for showing both timelines side by side. Below it
 * (half-splits, mobile) each pane would be too cramped to read, so the view
 * collapses to one pane with a Me/Team toggle. At or above it (e.g. a
 * full-width window on a 13" laptop) both panes render and the toggle is
 * hidden.
 */
const DUAL_PANE_MIN_SPLIT_WIDTH = 1024;

/**
 * The Activity tab: "Things I did" (the user's own action timeline) and the
 * team Firehose. Side by side when the split is wide enough; otherwise one
 * pane at a time behind a Me/Team segmented toggle (the same control other
 * list views use), persisted across sessions.
 */
export function ActivityView() {
  const panel = useSplitPanelOrThrow();
  const [tab, setTab] = makePersisted(createSignal<ActivityTab>('me'), {
    name: 'activity-view-tab',
  });

  const isDualPane = createMemo(
    () => (panel.panelSize.width ?? 0) >= DUAL_PANE_MIN_SPLIT_WIDTH
  );

  // A factory rather than a shared element: each pane mount gets its own
  // node instead of re-parenting one instance across Show branches.
  const tabs = () => (
    <TabsInset
      list={ACTIVITY_TABS}
      value={tab()}
      defaultValue="me"
      onChange={(value) => setTab(value as ActivityTab)}
    />
  );

  return (
    <Show
      when={isDualPane()}
      fallback={
        <Show
          when={tab() === 'team'}
          fallback={<MyActivityPane trailing={tabs()} />}
        >
          <FirehosePane trailing={tabs()} />
        </Show>
      }
    >
      <div class="flex h-full min-h-0">
        <div class="min-h-0 min-w-0 flex-1 border-r border-edge-muted">
          <MyActivityPane />
        </div>
        <div class="min-h-0 min-w-0 flex-1">
          <FirehosePane />
        </div>
      </div>
    </Show>
  );
}
