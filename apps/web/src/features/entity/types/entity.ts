import type { DateValue } from '@core/util/date';
import type { ApiLabel } from '@service-email/generated/schemas';
import type {
  GithubPullRequestCheckRun,
  GithubPullRequestComment,
  SoupCountedReaction,
  SoupLabel,
  SoupMessageAttachment,
  SoupMessageSender,
  SoupProperty,
  SoupThreadReply,
  CallStatus as StorageCallStatus,
} from '@service-storage/generated/schemas';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';

export type EntityBase = {
  id: string;
  name: string;
  ownerId: string;
  frecencyScore?: number;
  /** Viewer-owned favorite state from Soup; absent on search-only results. */
  isFavorited?: boolean;
  /**
   * The viewer's latest own mutation of this entity, present only on rows
   * from `touched_by_me` pages. The Recent feed sorts on it, so mutation
   * helpers may bump it optimistically.
   */
  touchedAt?: DateValue | null;
  /**
   * When the viewer was last notified about this entity, present only on
   * rows from `notified_at` pages. The inbox sorts and date-buckets on it,
   * and incoming notifications bump it optimistically.
   */
  notifiedAt?: DateValue | null;
  createdAt?: DateValue | null;
  updatedAt?: DateValue | null;
  viewedAt?: DateValue | null;
  sortTs?: DateValue | null;
};

type ForeignEntityBase = EntityBase & {
  type: 'foreign';
  foreignId: string;
  storedForId: string;
  storedForAuthEntity: 'team' | (string & {});
};

export type UnknownForeignEntity = ForeignEntityBase & {
  foreignSource: 'unknown';
  rawForeignSource: string;
  metadata: {
    [key: string]: unknown;
  };
};

/** A GitHub label; `color` is GitHub's six-digit hex without `#`. */
export type GithubPullRequestLabel = {
  name: string;
  color?: string | null;
};

// Consider making this a generic pull request entity so we can display
// pull requests from other sources besides github
export type GithubPullRequestEntity = ForeignEntityBase & {
  foreignSource: 'github_pull_request';
  metadata: {
    number: number;
    name: string;
    owner: string;
    repo: string;
    url: string;
    status: 'open' | 'merged' | 'closed';
    additions: number;
    deletions: number;
    comments: GithubPullRequestComment[];
    checks: GithubPullRequestCheckRun[];
    labels: GithubPullRequestLabel[];
    authorLogin?: string;
    authorId?: number;
    /** The pull request description (body), when stored. */
    description?: string;
    /** The branch carrying the pull request's changes, when stored. */
    headBranch?: string;
  };
};

export type ForeignEntity = UnknownForeignEntity | GithubPullRequestEntity;

type ChannelEntityLatestMessage = {
  messageId: string;
  threadId?: string | null;
  content: string;
  senderId: string;
  createdAt: DateValue;
  mentions: string[];
};

/**
 * The message a channel-family row activates when opened. Stamped at row
 * construction by producers whose row stands for one specific message (e.g.
 * search hits). Rows without a target are containers — the driving
 * notification decides at click time.
 */
export type ChannelEntityTarget = {
  messageId: string;
  threadId?: string;
};

/**
 * The comment a document row opens at when it is not derived from the row's
 * notifications, e.g. a preview rebuilt from its route.
 */
export type DocumentCommentTarget = {
  commentId: string;
};

/**
 * The resolved click intent for a channel-family row. Either a specific
 * message to jump to and highlight, or `latest` — open the channel at its
 * newest message with no highlight. A whole `channel` row with no unread
 * notification resolves to `latest` so the click lands where the row's
 * preview points (the latest message, which may be your own send) instead of
 * an older notification or nothing at all.
 */
export type ChannelClickTarget =
  | { kind: 'message'; messageId: string; threadId?: string }
  | { kind: 'latest' };

export type ChannelEntity = EntityBase & {
  type: 'channel';
  /** Filtered, bounded edge for the unread dot. Undefined denotes a legacy/full
   * row; an empty array denotes no unread messages. Never use for bulk reads. */
  unreadNotifications?: {
    id: string;
    state: 'unseen' | 'seen' | 'done';
    createdAt: DateValue;
  }[];
  channelType: 'direct_message' | 'private' | 'public' | 'team';
  interactedAt?: DateValue | null;
  participantIds?: string[];
  /**
   * Whether the viewer is an active participant of the channel. `false` only
   * for team channels of the viewer's teams they haven't joined (surfaced in
   * the Channels → Teams tab with a Join affordance); absent means the row
   * predates the flag and is treated as joined.
   */
  isParticipant?: boolean;
  latestMessage?: ChannelEntityLatestMessage;
  latestRootMessage?: ChannelEntityLatestMessage;
  target?: ChannelEntityTarget;
};

export type ChannelMessageEntity = EntityBase & {
  type: 'channel_message';
  channelId: string;
  channelName: string;
  channelType: ChannelEntity['channelType'];
  messageId: string;
  threadId?: string;
  senderId: string;
  content: string;
  target?: ChannelEntityTarget;
};

export type ChannelThreadEntity = EntityBase & {
  type: 'channel_thread';
  channelId: string;
  channelType?: ChannelEntity['channelType'];
  messageId: string;
  threadId: string;
  target?: ChannelEntityTarget;
  senderId: string;
  sender: SoupMessageSender;
  content: string;
  attachments: SoupMessageAttachment[];
  reactions: SoupCountedReaction[];
  editedAt?: DateValue | null;
  deletedAt?: DateValue | null;
  thread: {
    replyCount: number;
    latestReplyAt?: DateValue | null;
    preview: SoupThreadReply[];
  };
  replyCount?: number;
  latestReplyAt?: DateValue | null;
};

export type ChatEntity = EntityBase & {
  type: 'chat';
  model?: string | null;
  projectId?: string;
  properties?: SoupProperty[];
};

export type AgentSessionEntity = EntityBase & {
  type: 'agent_session';
  isArchived?: boolean;
  botId: string;
  harness?: string;
  repoUrl?: string | null;
  /** Starting branch selected at creation, not the current working branch. */
  repoBranch?: string | null;
  pullRequestUrl?: string | null;
  workingBranch?: string | null;
  pullRequestState?: 'open' | 'draft' | 'closed' | 'merged' | null;
  pullRequestId?: string | null;
  turnState?: string | null;
  bot?: { id: string; name: string; avatarUrl?: string | null } | null;
  threadId?: string | null;
  status: string;
  properties?: SoupProperty[];
};

/** Named sub types - 'task', 'snippet' and 'skill' */
export type NamedSubType = 'task' | 'snippet' | 'skill';

/** SubType for documents - tasks, snippets and skills */
export type SubType = {
  type: NamedSubType;
  is_completed?: boolean;
} | null;

/** Wire subtypes without a dedicated block, including initiative_description, become null. */
export const toSubType = (
  wire: { type: string; is_completed?: boolean } | null | undefined
): SubType => {
  if (wire == null) return null;
  const { type } = wire;
  return type === 'task' || type === 'snippet' || type === 'skill'
    ? { type, is_completed: wire.is_completed }
    : null;
};

export type BaseDocumentEntity = EntityBase & {
  type: 'document';
  fileType?: string;
  projectId?: string;
  subType?: SubType;
  properties?: SoupProperty[];
};

export type TaskEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType: { type: 'task'; is_completed?: boolean };
  projectId?: string;
};

export type SnippetEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType: { type: 'snippet' };
  projectId?: string;
};

export type SkillEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType: { type: 'skill' };
  projectId?: string;
};

export type MarkdownEntity = EntityBase & {
  type: 'document';
  fileType: 'md';
  subType?: null;
  projectId?: string;
};

export type DocumentEntity = BaseDocumentEntity | MarkdownEntity;

export const getEntityProjectId = (e: EntityData): string | false => {
  return 'projectId' in e ? (e.projectId ?? false) : false;
};

export type EmailThreadParticipants = Array<{ email: string; name?: string }>;

export type EmailAttachment = {
  id: string;
  filename?: string | null;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

// We spread ApiThreadPreviewCursor into the email entity, should we explcitly include all those fields here, or only add them as needed?
export type EmailEntity = EntityBase & {
  type: 'email';
  isRead: boolean;
  isDraft: boolean;
  snippet?: string;
  isImportant: boolean;
  /** Server-computed Signal membership; unavailable on some search results. */
  isSignal?: boolean;
  done: boolean;
  projectId?: string;
  participants?: EmailThreadParticipants;
  senderEmail?: string;
  senderName?: string;
  /** The linked inbox (email_links row) this thread belongs to. */
  linkId?: string;
  labels?: SoupLabel[] | ApiLabel[];
  hasIcsAttachment?: boolean;
  attachments?: EmailAttachment[];
  properties?: SoupProperty[];
  /** ISO 8601 time of the thread draft's confirmed scheduled send. */
  scheduledSendTime?: string;
};

export type ProjectEntity = EntityBase & {
  type: 'project';
  projectId?: string;
  properties?: SoupProperty[];
};

export type CallStatus = StorageCallStatus;

/** Session-scoped guest identity on a call; not a Macro account. */
export type CallGuest = {
  id: string;
  displayName: string;
};

export type CallEntity = EntityBase & {
  type: 'call';
  channelId?: string | null;
  channelName?: string;
  isActive: boolean;
  status: CallStatus;
  /** Compatibility flag derived from status. */
  attended: boolean;
  durationMs?: number;
  /** Macro users only; guests are listed separately in `guests`. */
  participantIds: string[];
  guests?: CallGuest[];
  summary?: string;
  properties?: SoupProperty[];
};

/**
 * What a routine is doing now. A run in progress outranks activation, and a
 * paused routine keeps its stale `next_run_at`, so pause outranks the schedule.
 */
export type RoutineStatus =
  | { kind: 'running' }
  | { kind: 'paused' }
  | { kind: 'scheduled'; nextRunAt: string }
  | { kind: 'unscheduled' };

export function routineStatus(facts: {
  enabled: boolean;
  isRunning: boolean;
  nextRunAt?: string | null;
}): RoutineStatus {
  if (facts.isRunning) return { kind: 'running' };
  if (!facts.enabled) return { kind: 'paused' };
  if (facts.nextRunAt) return { kind: 'scheduled', nextRunAt: facts.nextRunAt };
  return { kind: 'unscheduled' };
}

export type RoutineEntity = EntityBase & {
  type: 'routine';
  /** Legacy single schedule, when the routine has exactly one cron trigger. */
  cron?: string;
  /** Running is derived from the server claim and the backend's stale-claim
   *  window; claims update live via the connection-gateway websocket. */
  status: RoutineStatus;
  /** ISO timestamp of the last completed run. */
  lastRunAt?: string | null;
};

export type CrmCompanyDomain = {
  id: string;
  companyId: string;
  domain: string;
  createdAt?: DateValue | null;
};

export type CrmCompanyEntity = EntityBase & {
  type: 'crm_company';
  teamId: string;
  description?: string;
  /** Whether team-wide email visibility is enabled for this company.
   * `undefined` means not loaded — search results don't carry it; the
   * full value arrives with the soup row or the company detail query. */
  emailSync?: boolean;
  /** Whether the company has been hidden from the CRM listings. Only
   * admin/owner team members can see `hidden: true` rows from the soup
   * endpoint. */
  hidden: boolean;
  domains: CrmCompanyDomain[];
  /** CRM properties (Stage / Owner / Revenue + custom) attached to the
   * company. Populated by the soup queries; search results don't carry
   * them. */
  properties?: SoupProperty[];
};

export type CrmContactEntity = EntityBase & {
  type: 'crm_contact';
  teamId?: string;
  companyName?: string;
  firstInteraction?: string;
  lastInteraction?: string;
  /** The company the contact belongs to. */
  companyId: string;
  /** The contact's email address. */
  email: string;
  /** Whether the contact has been hidden from the CRM listings. Only
   * admin/owner team members can see `hidden: true` rows. */
  hidden: boolean;
};

/** A Macro Database. Not a Soup entity: it has no view history, so `createdAt` is its only timestamp. */
export type DatabaseEntity = EntityBase & {
  type: 'database';
  /** What the viewer may do with the database. */
  grant: AccessLevel;
};

/** A Macro Form. Like a database, not a Soup entity: `createdAt` is its only timestamp. */
export type FormEntity = EntityBase & {
  type: 'form';
  /** What the viewer may do: view responds, edit builds and reads responses. */
  access: 'view' | 'edit' | 'owner';
};

/** Normalized time shape of a calendar event soup row. */
export type CalendarEventEntityTime =
  | { kind: 'timed'; startsAt: string; endsAt: string }
  | { kind: 'allDay'; startDate: string; endDate: string };

export type CalendarEventEntity = EntityBase & {
  type: 'calendar_event';
  /** Canonical event status (`confirmed`, `tentative`, `cancelled`). */
  status: string;
  /** Master event time. Absent when the wire shape could not be read. */
  time?: CalendarEventEntityTime;
  /**
   * The instance this row means, when one was resolved. Search rows carry it
   * so a click lands on the relevant occurrence of a recurring series rather
   * than the master's original start; soup rows leave it unset.
   */
  occurrenceKey?: string;
  /** Whether the series carries a recurrence rule, so a row can flag it
   * without parsing the rules. Only search rows populate it. */
  isRecurring?: boolean;
  /** The event's organizer (its creator, in Google's model), when named.
   * Only search rows populate it. */
  organizer?: { name?: string; email?: string };
  /** Free-text description, when the event carries one. May contain HTML from
   * the source. Only search rows populate it. */
  description?: string;
  /** Direct join URL when known. */
  conferenceUrl?: string;
  /** Whether the canonical source prohibits mutation. */
  isReadOnly: boolean;
  properties?: SoupProperty[];
};

/** A native project, distinct from folder entities. */
export type InitiativeEntity = EntityBase & {
  type: 'initiative';
  properties?: SoupProperty[];
};

export type EntityData =
  | AgentSessionEntity
  | ChannelEntity
  | ChannelMessageEntity
  | ChannelThreadEntity
  | ChatEntity
  | DocumentEntity
  | TaskEntity
  | SnippetEntity
  | EmailEntity
  | ProjectEntity
  | InitiativeEntity
  | CallEntity
  | CrmCompanyEntity
  | CrmContactEntity
  | DatabaseEntity
  | FormEntity
  | RoutineEntity
  | CalendarEventEntity
  | ForeignEntity;

const ENTITY_TYPE_VALUES = new Set<EntityData['type']>([
  'agent_session',
  'channel',
  'channel_message',
  'channel_thread',
  'chat',
  'document',
  'email',
  'project',
  'initiative',
  'call',
  'crm_company',
  'crm_contact',
  'database',
  'form',
  'routine',
  'calendar_event',
  'foreign',
]);

const _isEntityData = (item: unknown): item is EntityData => {
  if (typeof item !== 'object') return false;

  if (!item) return false;

  if (!('type' in item)) return false;

  if (typeof item.type !== 'string') return false;

  return ENTITY_TYPE_VALUES.has(item.type as EntityData['type']);
};

export const isTaskEntity = (entity: EntityData): entity is TaskEntity => {
  return (
    entity.type === 'document' &&
    entity.fileType === 'md' &&
    entity.subType?.type === 'task'
  );
};

export const isSnippetEntity = (
  entity: EntityData
): entity is SnippetEntity => {
  return (
    entity.type === 'document' &&
    entity.fileType === 'md' &&
    entity.subType?.type === 'snippet'
  );
};

export const isSkillEntity = (entity: EntityData): entity is SkillEntity => {
  return (
    entity.type === 'document' &&
    entity.fileType === 'md' &&
    entity.subType?.type === 'skill'
  );
};

export const isGithubPrEntity = (
  entity: EntityData
): entity is GithubPullRequestEntity => {
  return (
    entity.type === 'foreign' && entity.foreignSource === 'github_pull_request'
  );
};

export const isUnknownForeignEntity = (
  entity: EntityData
): entity is UnknownForeignEntity => {
  return entity.type === 'foreign' && entity.foreignSource === 'unknown';
};

export const isChannelEntity = (
  entity: EntityData
): entity is ChannelEntity => {
  return entity.type === 'channel';
};

/**
 * A channel the viewer can see but is not a participant of (a team channel of
 * their team they haven't joined). These rows render a Join affordance and
 * are not navigable — the viewer can't read the channel until they join.
 *
 * Deliberately not a type guard: a `false` result still includes channels.
 */
export const isNonMemberChannelEntity = (entity: EntityData): boolean => {
  return isChannelEntity(entity) && entity.isParticipant === false;
};

export const isChannelMessageEntity = (
  entity: EntityData
): entity is ChannelMessageEntity => {
  return entity.type === 'channel_message';
};

export const isChannelThreadEntity = (
  entity: EntityData
): entity is ChannelThreadEntity => {
  return entity.type === 'channel_thread';
};

export const isChatEntity = (entity: EntityData): entity is ChatEntity => {
  return entity.type === 'chat';
};

export const isEmailEntity = (entity: EntityData): entity is EmailEntity => {
  return entity.type === 'email';
};

export const isProjectEntity = (
  entity: EntityData
): entity is ProjectEntity => {
  return entity.type === 'project';
};

export const isCallEntity = (entity: EntityData): entity is CallEntity => {
  return entity.type === 'call';
};

export const isRoutineEntity = (
  entity: EntityData
): entity is RoutineEntity => {
  return entity.type === 'routine';
};

export const isCrmCompanyEntity = (
  entity: EntityData
): entity is CrmCompanyEntity => {
  return entity.type === 'crm_company';
};

export const isCrmContactEntity = (
  entity: EntityData
): entity is CrmContactEntity => {
  return entity.type === 'crm_contact';
};

/** The full-email identity shared by CRM contacts and Macro users. Plus
 * aliases stay distinct, as in the backend's authorized contact deduplication. */
export const crmContactEmailKey = (email: string) => email.trim().toLowerCase();

export const isDocumentEntity = (
  entity: EntityData
): entity is DocumentEntity => {
  return entity.type === 'document';
};

const _isMarkdownEntity = (entity: EntityData): entity is MarkdownEntity => {
  return (
    entity.type === 'document' && entity.fileType === 'md' && !entity.subType
  );
};

const _isPureDocumentEntity = (
  entity: EntityData
): entity is DocumentEntity => {
  return (
    entity.type === 'document' &&
    entity.subType?.type !== 'task' &&
    entity.subType?.type !== 'snippet' &&
    entity.subType?.type !== 'skill'
  );
};

export type EntityType = EntityData['type'];

export type ExpandedEntityType = EntityType | 'task' | 'snippet' | 'skill';

export type EntityWithProperties<T extends EntityData> = T & {
  properties?: SoupProperty[];
};

export type TaskEntityWithProperties = EntityWithProperties<TaskEntity>;

export type ProjectContainedEntity<T extends EntityData = EntityData> = T & {
  projectId: string;
};

export const isProjectContainedEntity = <T extends EntityData>(
  entity: T
): entity is ProjectContainedEntity<T> => {
  return getEntityProjectId(entity) !== false;
};

/**
 * Utility type that makes only specified fields required from an EntityData type,
 * while all other fields become optional.
 * @example
 * type MinimalEntity = PartialEntity<'id' | 'name'>;
 */
