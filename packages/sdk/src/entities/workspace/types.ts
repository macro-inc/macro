import type {
  ApiEntityFilterAst,
  SoupApiItem,
} from '../../../generated/storage/types.gen';
import type { CalendarEvent } from '../calendar/event';
import type { CallRecord } from '../calls/call-record';
import type { Channel } from '../channels/channel';
import type { Thread } from '../channels/thread';
import type { Chat } from '../chats/chat';
import type { Document } from '../documents/document';
import type { EmailThread } from '../email/thread';
import type { ForeignEntity } from '../foreign/foreign-entity';
import type { Project } from '../projects/project';

/** Workspace types supported by the browsing API. Tasks are documents. */
export type WorkspaceType =
  | 'calendar_event'
  | 'document'
  | 'ai_chat'
  | 'project'
  | 'email'
  | 'channel'
  | 'channel_thread'
  | 'call'
  | 'foreign_entity';

/** A tag label visible to the caller, optionally qualified by ownership scope. */
export type WorkspaceTag = { label: string; scope: 'personal' | 'team' };

/**
 * Server-validated AST filters, identical to the normal workspace API. Use
 * `{l: literal}`, `{'&': [left, right]}`, `{'|': [left, right]}` or `{'!': expr}`.
 * `&` and `|` require exactly two expressions; nest them for three or more.
 * A single condition is `{l: literal}` without an `&` wrapper.
 * Each entity filter applies only to that type; `propf` applies across types.
 * See {@link WorkspaceNamespace} for task and time-window examples.
 */
export type WorkspaceFilters = Pick<
  ApiEntityFilterAst,
  | 'df'
  | 'pf'
  | 'cf'
  | 'ef'
  | 'chanf'
  | 'cthf'
  | 'callf'
  | 'fef'
  | 'calf'
  | 'propf'
>;

/** Options shared by bounded pages and automatic iteration. */
export type WorkspaceListOptions = WorkspaceFilters & {
  /** Omitted or empty means all supported types; signal defaults to email when omitted. */
  includeTypes?: WorkspaceType[];
  favoritesOnly?: boolean;
  /** Defaults to recently_updated, descending. */
  sortBy?: 'recently_viewed' | 'recently_updated' | 'recently_created';
  /** Page size, default 50, clamped to 1–500. Iteration may fetch many pages. */
  limit?: number;
  /** Case-insensitive labels resolved against the caller's personal/team tags. */
  tags?: Array<{ label: string; scope?: 'personal' | 'team' }>;
  /** Default any. All rejects ambiguous unscoped labels rather than guessing. */
  tagsMatch?: 'any' | 'all';
  /** Connected inbox email address. Omit to include all accessible/delegated inboxes. */
  inbox?: string;
  /** Important/signal email: overrides ef with Importance=true AND Shared=exclude. */
  emailPreset?: 'signal';
  /** Default inbox. Use signal + inbox for important emails, not the important view. */
  emailView?:
    | 'inbox'
    | 'sent'
    | 'drafts'
    | 'starred'
    | 'all'
    | 'important'
    | 'other'
    | `user:${string}`;
};

/** Resume a page with its opaque cursor and the same options. */
export type WorkspacePageOptions = WorkspaceListOptions & { cursor?: string };

type Entry<
  Tag extends SoupApiItem['tag'],
  Type extends WorkspaceType,
  Entity,
> = {
  type: Type;
  id: string;
  /** Existing entity handle for subsequent reads or mutations; no eager detail fetch. */
  entity: Entity;
  /** Full generated API snapshot, including timestamps and type-specific metadata. */
  snapshot: Extract<SoupApiItem, { tag: Tag }>;
  /** Visible labels only; option IDs outside the caller's tag sets are excluded. */
  tags: WorkspaceTag[];
};

/** Discriminated listing result. Read snapshot data without additional API calls. */
export type WorkspaceItem =
  | (Entry<'document', 'document', Document> & {
      name: string;
      fileType?: string | null;
      subType?: string | null;
    })
  | (Entry<'chat', 'ai_chat', Chat> & { name: string })
  | (Entry<'project', 'project', Project> & { name: string })
  | (Entry<'emailThread', 'email', EmailThread> &
      Pick<
        Extract<SoupApiItem, { tag: 'emailThread' }>['data'],
        | 'snippet'
        | 'senderName'
        | 'senderEmail'
        | 'inboxVisible'
        | 'isRead'
        | 'isDraft'
      > & { subject?: string | null })
  | (Entry<'channel', 'channel', Channel> & { name?: string | null })
  | (Entry<'channelThread', 'channel_thread', Thread> & { channelId: string })
  | (Entry<'call', 'call', CallRecord> & { createdBy: string })
  | (Entry<'calendarEvent', 'calendar_event', CalendarEvent> &
      Pick<
        Extract<SoupApiItem, { tag: 'calendarEvent' }>['data'],
        | 'title'
        | 'status'
        | 'location'
        | 'conferenceUrl'
        | 'conferenceProvider'
        | 'time'
      >)
  | (Entry<'foreignEntity', 'foreign_entity', ForeignEntity> &
      Pick<
        Extract<SoupApiItem, { tag: 'foreignEntity' }>['data'],
        'foreignEntityId' | 'foreignEntitySource' | 'metadata'
      >);

/** A bounded page. A cursor means more results exist, not an exact total count. */
export type WorkspacePage = {
  items: WorkspaceItem[];
  nextCursor?: string | null;
  hasMore: boolean;
};
