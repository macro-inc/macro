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

export type EntityBase = {
  id: string;
  name: string;
  ownerId: string;
  frecencyScore?: number;
  /**
   * The viewer's latest own mutation of this entity, present only on rows
   * from `touched_by_me` pages. The Recent feed sorts on it, so mutation
   * helpers may bump it optimistically.
   */
  touchedAt?: DateValue | null;
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
    authorLogin?: string;
    authorId?: number;
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
  projectId?: string;
  properties?: SoupProperty[];
};

/** Named sub types - 'task', 'snippet' and 'skill' */
export type NamedSubType = 'task' | 'snippet' | 'skill';

/** SubType for documents - tasks, snippets and skills */
export type SubType = {
  type: NamedSubType;
  is_completed?: boolean;
} | null;

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
};

export type ProjectEntity = EntityBase & {
  type: 'project';
  projectId?: string;
  properties?: SoupProperty[];
};

export type CallStatus = StorageCallStatus;

export type CallEntity = EntityBase & {
  type: 'call';
  channelId: string;
  channelName?: string;
  isActive: boolean;
  status: CallStatus;
  /** Compatibility flag derived from status. */
  attended: boolean;
  durationMs?: number;
  participantIds: string[];
  summary?: string;
  properties?: SoupProperty[];
};

export type AutomationEntity = EntityBase & {
  type: 'automation';
  /** Cron expression controlling when the automation runs. */
  cron: string;
  /** Whether the automation is currently enabled. */
  enabled: boolean;
  /** ISO timestamp of the next scheduled run, or null when paused / unscheduled. */
  nextRunAt?: string | null;
  /** ISO timestamp of the last completed run. */
  lastRunAt?: string | null;
  /** True when a run is actively claimed on the server. Derived from the
   *  scheduled action's `claimed` timestamp + the backend's stale-claim
   *  window; updated live via the connection-gateway websocket. */
  isRunning?: boolean;
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
  /** The company the contact belongs to. */
  companyId: string;
  /** The contact's email address. */
  email: string;
  /** Whether the contact has been hidden from the CRM listings. Only
   * admin/owner team members can see `hidden: true` rows. */
  hidden: boolean;
};

export type ReminderEntity = EntityBase & {
  type: 'reminder';
  /** What to remind the user about. Doubles as {@link EntityBase.name}. */
  description: string;
  /** The entity the reminder is about, when it is attached to one. Clicking a
   * reminder navigates here rather than to the reminder itself, and the row
   * borrows this entity's icon.
   *
   * `type` is already mapped to the display {@link EntityType} (`email`,
   * `foreign`), not the canonical API names (`email_thread`,
   * `foreign_entity`). `fileType`/`subType` are resolved server-side and only
   * present for documents — without them a referenced document has no
   * resolvable block, since the icon and open paths are both synchronous.
   *
   * A reminder never references another reminder — the mapper yields
   * `undefined` for that — so the type excludes it and the reference stays
   * assignable to the preview/open helpers, which only know real targets. */
  referencedEntity?: {
    id: string;
    // Calendar events are excluded alongside reminders: neither has a
    // previewable block, and the mapper yields `undefined` for both.
    type: Exclude<EntityType, 'reminder' | 'calendar_event'>;
    fileType?: string;
    subType?: string;
  };
  /** Whether the reminder fires once or on a cron schedule. */
  scheduleType: 'once' | 'recurring';
  /** Cron expression, for a recurring reminder. */
  cron?: string;
  /** Timezone the cron is evaluated in, for a recurring reminder. */
  timezone?: string;
  /** The next firing. Soup orders reminders on this. */
  nextRunAt: DateValue;
  /** When false, the dispatcher skips this reminder. */
  enabled: boolean;
  /** Set once a one-shot reminder has fired. */
  completedAt?: DateValue | null;
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

export type EntityData =
  | ChannelEntity
  | ChannelMessageEntity
  | ChannelThreadEntity
  | ChatEntity
  | DocumentEntity
  | TaskEntity
  | SnippetEntity
  | EmailEntity
  | ProjectEntity
  | CallEntity
  | CrmCompanyEntity
  | CrmContactEntity
  | AutomationEntity
  | ReminderEntity
  | CalendarEventEntity
  | ForeignEntity;

const ENTITY_TYPE_VALUES = new Set<EntityData['type']>([
  'channel',
  'channel_message',
  'channel_thread',
  'chat',
  'document',
  'email',
  'project',
  'call',
  'crm_company',
  'crm_contact',
  'automation',
  'reminder',
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

export const isReminderEntity = (
  entity: EntityData
): entity is ReminderEntity => {
  return entity.type === 'reminder';
};

export const isAutomationEntity = (
  entity: EntityData
): entity is AutomationEntity => {
  return entity.type === 'automation';
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
