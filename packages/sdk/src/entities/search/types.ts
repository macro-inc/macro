import type {
  CalendarEventSearchScope,
  UnifiedSearchResponseItem,
} from '../../../generated/search/types.gen';
import type { AgentSession } from '../agent-sessions/agent-session';
import type { CalendarEvent } from '../calendar/event';
import type { CallRecord } from '../calls/call-record';
import type { Channel } from '../channels/channel';
import type { Message } from '../channels/message';
import type { Chat } from '../chats/chat';
import type { Company } from '../crm/company';
import type { Document } from '../documents/document';
import type { EmailThread } from '../email/thread';
import type { Project } from '../projects/project';
import type { TagFilter } from '../workspace/query';
import type { WorkspaceTag } from '../workspace/types';
import type { SearchOn } from './options';

/**
 * The kinds of item one search can reach. `document` includes tasks;
 * `channel` covers channel names and the messages posted in them; `company`
 * is CRM, searched only when named.
 */
export type SearchType =
  | 'document'
  | 'email'
  | 'channel'
  | 'project'
  | 'call'
  | 'calendar_event'
  | 'agent_session'
  | 'chat'
  | 'company';

/** Options shared by {@link SearchNamespace.page} and {@link SearchNamespace.all}. */
export type SearchOptions = {
  /**
   * Which kinds of item to search. Omit to search every kind but `company`;
   * set it only when the user scopes the request, and keep that scope on
   * follow-ups and retries.
   */
  types?: SearchType[];
  /** Match names, content or both (the default). Projects and calendar events have only names. */
  searchOn?: SearchOn;
  /**
   * `partial` (the default) matches each word as a prefix, so `scri` matches
   * `script`; `exact` matches whole tokens or a quoted phrase, for an exact
   * word, identifier or email address.
   */
  matchType?: 'partial' | 'exact';
  /**
   * Only items carrying these tags, by case-insensitive label; set `scope`
   * only when the user tells personal and team tags apart. An unknown label
   * fails with the available tags. Only documents, email, projects, calls and
   * calendar events carry tags.
   */
  tags?: TagFilter[];
  /** `any` (the default) or `all` of `tags`; `all` rejects a label both scopes share. */
  tagsMatch?: 'any' | 'all';
  /** Restrict email results to one connected inbox, by its address. Omit for every accessible inbox. */
  inbox?: string;
  /**
   * Search only these agent sessions' transcripts, and nothing else; `types`
   * is then ignored. Pass your own session to find the exact words of
   * something said earlier in it.
   */
  agentSessions?: AgentSession[];
  /**
   * `own` (the default): events on the caller's own and delegated calendars.
   * `shared_with_you`: only events shared to a channel they are in that are
   * on none of their calendars.
   */
  calendarScope?: CalendarEventSearchScope;
  /** Results per request, default 50. Iteration may fetch many pages. */
  pageSize?: number;
};

/** Resume a page with its opaque cursor and the same options. */
export type SearchPageOptions = SearchOptions & { cursor?: string };

type Hit = UnifiedSearchResponseItem;

type Entry<Kind extends Hit['type'], Type extends string, Entity> = {
  type: Type;
  /** A handle to the matching item, for reads and mutations; nothing is fetched yet. */
  entity: Entity;
  /** The search hit: name, highlights, matching passages and metadata, readable without another request. */
  hit: Extract<Hit, { type: Kind }>;
  /** The caller-visible tags on the item. */
  tags: WorkspaceTag[];
};

/** One match, discriminated by `type`. */
export type SearchResult =
  | Entry<'document', 'document', Document>
  | Entry<'email', 'email', EmailThread>
  | Entry<'channel', 'channel', Channel>
  | (Entry<'channelMessage', 'channel_message', Message> & {
      /** The channel the message was posted in. */
      channel: Channel;
    })
  | Entry<'project', 'project', Project>
  | Entry<'call', 'call', CallRecord>
  | Entry<'calendarEvent', 'calendar_event', CalendarEvent>
  | Entry<'agentSession', 'agent_session', AgentSession>
  | Entry<'chat', 'chat', Chat>
  | Entry<'company', 'company', Company>;

/** A bounded page. A cursor means more results exist, not an exact total count. */
export type SearchPage = {
  results: SearchResult[];
  nextCursor?: string | null;
  hasMore: boolean;
};
