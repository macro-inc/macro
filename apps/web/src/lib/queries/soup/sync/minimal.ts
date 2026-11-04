/**
 * What the first streamed sync pass guarantees, shared by the plan builder and
 * the readers that answer from the cache once a lane completes. No imports:
 * readers load it without the plan builder. Contract:
 * docs/architecture/streamed-cache-sync.md.
 */

/**
 * Minimal Task / Document row: what a row renders plus every field lists
 * filter, sort or group by. The local filter index indexes a document only
 * when it has all of these, so keep the Task model's value fields inside it.
 * Spreads `SoupPropertyValueFields`; the query appends that fragment.
 * Confirmed by the cache's indexing test: without `isFavorited` rows are
 * written but never indexed, and local filters silently fall back.
 */
export const SYNC_MINIMAL_DOCUMENT_FIELDS = `__typename
id
cacheProjection
... on GraphqlSoupDocument {
  name
  ownerId
  fileType
  projectId
  createdAt
  updatedAt
  viewedAt
  deletedAt
  isFavorited
  subType { __typename ... on GraphqlTaskSubType { isCompleted } }
  properties { id propertyDefinitionId value { ...SoupPropertyValueFields } }
  notifications { __typename id entityId entityType state }
}`;

/** Lane that streams every task with minimal fields. */
export const TASKS_SYNC_LANE_ID = 'tasks';

/** Coverage the `tasks` lane stores when a pass completes. */
export const TASK_SYNC_COVERAGE = { entity: 'task', scope: 'all' } as const;

/**
 * Lane that streams every task project (initiative) with what a project chip
 * shows: `displayName` and `viewerPermission { accessLevel }`.
 */
export const TASK_PROJECTS_SYNC_LANE_ID = 'task-projects';

/** Coverage the `task-projects` lane stores when a pass completes. */
export const TASK_PROJECT_SYNC_COVERAGE = {
  entity: 'initiative',
  scope: 'all',
} as const;

/**
 * Minimal channel row: the app's channel list (`ChannelsContext`: names,
 * types, participants, agent DMs, read times) plus every field the local
 * filter index needs to index a channel (`cacheProjection`, `ownerId`,
 * `channelType`, `teamId`, `organizationId`, `isParticipant`, `createdAt`,
 * `updatedAt`, `notifications`). No messages or threads.
 */
export const SYNC_MINIMAL_CHANNEL_FIELDS = `__typename
id
cacheProjection
notifications { __typename id entityId entityType state }
... on GraphqlSoupChannel {
  name
  channelType
  ownerId
  organizationId
  teamId
  createdAt
  updatedAt
  viewedAt
  interactedAt
  isParticipant
  autoJoinTeam
  frecencyScore
  agentDm { botId name avatarUrl }
  participants { channelId userId role joinedAt leftAt }
}`;

/** Lane that streams the viewer's contacts (`GraphqlUser.contacts`). */
export const CONTACTS_SYNC_LANE_ID = 'contacts';

/** Coverage the `contacts` lane stores when a pass completes. */
export const CONTACT_SYNC_COVERAGE = {
  entity: 'contact',
  scope: 'all',
} as const;

/** Lane that streams every channel the viewer takes part in. */
export const CHANNELS_SYNC_LANE_ID = 'channels';

/** Coverage the `channels` lane stores when a pass completes. */
export const CHANNEL_SYNC_COVERAGE = {
  entity: 'channel',
  scope: 'all',
} as const;
