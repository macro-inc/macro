import {
  defineQueryFilters,
  type Query,
} from '@app/features/next-soup/filters/filter-store';
import { ENABLE_SNIPPETS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { EntityEventRow } from './entity-event-row';
import { mapMyActivityEntity } from './entity-events';
import { createSoupTimelineFeed } from './feeds';
import { mergeTimelineFeeds } from './merge-feeds';
import { TimelineView } from './timeline-view';
import { useChannelLookup } from './use-channel-lookup';

/**
 * Server filters for the user's own actions: messages/threads they took part
 * in (per-message soup rows), documents/tasks they created, agent chats and
 * folders they own, and calls they attended — plus, via the email view, the
 * emails they sent. Drafts live in a separate email view, so they are a
 * second query merged in by the view.
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
 * Things I did: a timeline of the user's own recent actions at event
 * granularity — messages sent, threads replied to, emails sent, drafts
 * started, documents created/edited, tasks and folders created, agent
 * sessions, and calls attended.
 */
export function MyActivityView() {
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

  return (
    <TimelineView
      title="Things I did"
      description="A timeline of your recent actions — for retracing your steps."
      feed={feed}
      emptyTitle="No activity yet"
      emptyDescription="Messages and emails you send, documents you edit, and tasks you create will appear here."
      renderItem={(item) =>
        item.kind === 'entity-event' ? (
          <EntityEventRow item={item} resolveChannel={resolveChannel} />
        ) : null
      }
    />
  );
}
