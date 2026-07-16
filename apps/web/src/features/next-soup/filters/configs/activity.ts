import {
  ENABLE_SNIPPETS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { defineQueryFilters } from '../filter-store/compile';
import type { Query } from '../filter-store/types';
import { config, NIL_UUID } from './base';

const getSnippetSubtypeExclude = (): Query['exclude'] =>
  ENABLE_SNIPPETS() ? {} : { subType: ['snippet'] };

/**
 * Server filters for the Firehose view: a timeline of everything going on in
 * the team. Opts in every activity-bearing entity type — channels (team
 * channels and DMs), channel threads, documents/tasks, agent chats, folders,
 * and calls — while restricting emails to CRM-shared threads, whose
 * team-wide visibility is inherited from CRM permissions.
 */
export const getFirehoseFilters = (): Query =>
  defineQueryFilters(
    {
      include: {
        emailShared: 'only',
        // Foreign entities (e.g. GitHub PRs) join the feed only while the
        // supported-foreign-entities rollout is on; rendering is gated on
        // the same flag client-side.
        ...(ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE
          ? { foreignEntitySource: ['github_pull_request'] }
          : {}),
      },
      exclude: {
        // Channel threads are excluded by default — referencing the id field
        // opts them in without constraining them.
        channelThreadId: [NIL_UUID],
        ...getSnippetSubtypeExclude(),
      },
      emailView: 'all',
    },
    { skipTargets: ['df', 'cf', 'pf', 'chanf', 'callf'] }
  );

/**
 * Server filters for the "Things I did" view: a timeline of the user's own
 * actions — documents/tasks they created, emails they sent, channels where
 * they sent messages, threads they participated in, agent chats and folders
 * they own, and calls they attended.
 */
export const getMyActivityFilters = (userId: string): Query =>
  defineQueryFilters({
    include: {
      documentOwnerId: [userId],
      chatOwnerId: [userId],
      folderOwnerId: [userId],
      channelSenderId: [userId],
      channelThreadParticipantId: [userId],
      callAttended: true,
    },
    exclude: getSnippetSubtypeExclude(),
    emailView: 'sent',
  });

export const firehoseFilter = config({
  id: 'firehose',
  predicate: (e) =>
    e.type !== 'crm_company' &&
    e.type !== 'crm_contact' &&
    e.type !== 'automation',
  query: () => getFirehoseFilters(),
});

export const myActivityFilter = config({
  id: 'my-activity',
  // Server queries scope each entity type to the user's own actions; the
  // client predicate mirrors what is knowable from entity data alone (e.g.
  // channel message senders aren't loaded, so channels pass through).
  predicate: (e, ctx) => {
    if (!ctx.userId) return false;
    switch (e.type) {
      case 'document':
      case 'chat':
      case 'project':
        return e.ownerId === ctx.userId;
      case 'email':
        return !e.isDraft;
      case 'channel':
      case 'channel_message':
      case 'channel_thread':
        return true;
      case 'call':
        return e.attended;
      default:
        return false;
    }
  },
  query: (ctx) => getMyActivityFilters(ctx.userId ?? ''),
});
