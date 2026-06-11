import type { DateValue } from '@core/util/date';
import type { ApiLabel } from '@service-email/generated/schemas';
import type {
  GithubPullRequestCheckRun,
  GithubPullRequestComment,
  SoupLabel,
  SoupProperty,
  CallStatus as StorageCallStatus,
} from '@service-storage/generated/schemas';

export type EntityBase = {
  id: string;
  name: string;
  ownerId: string;
  frecencyScore?: number;
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
  };
};

export type ForeignEntity = UnknownForeignEntity | GithubPullRequestEntity;

export type ChannelEntity = EntityBase & {
  type: 'channel';
  channelType: 'direct_message' | 'private' | 'public' | 'team';
  interactedAt?: DateValue | null;
  participantIds?: string[];
  latestMessage?: {
    messageId: string;
    threadId?: string | null;
    content: string;
    senderId: string;
    createdAt: DateValue;
  };
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
};

export type ChatEntity = EntityBase & {
  type: 'chat';
  projectId?: string;
};

/** Named sub types - 'task' and 'snippet' */
export type NamedSubType = 'task' | 'snippet';

/** SubType for documents - tasks and snippets */
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
};

export type ProjectEntity = EntityBase & {
  type: 'project';
  projectId?: string;
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

export type EntityData =
  | ChannelEntity
  | ChannelMessageEntity
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
  | ForeignEntity;

const ENTITY_TYPE_VALUES = new Set<EntityData['type']>([
  'channel',
  'channel_message',
  'chat',
  'document',
  'email',
  'project',
  'call',
  'crm_company',
  'crm_contact',
  'automation',
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

export const isChannelMessageEntity = (
  entity: EntityData
): entity is ChannelMessageEntity => {
  return entity.type === 'channel_message';
};

const _isChatEntity = (entity: EntityData): entity is ChatEntity => {
  return entity.type === 'chat';
};

export const isEmailEntity = (entity: EntityData): entity is EmailEntity => {
  return entity.type === 'email';
};

const _isProjectEntity = (entity: EntityData): entity is ProjectEntity => {
  return entity.type === 'project';
};

export const isCallEntity = (entity: EntityData): entity is CallEntity => {
  return entity.type === 'call';
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
  return entity.type === 'document' && entity.subType?.type !== 'task';
};

export type EntityType = EntityData['type'];

export type ExpandedEntityType = EntityType | 'task';

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
