import { match } from 'ts-pattern';
import type {
  EntityFilters,
  UnifiedSearchRequest,
  UnifiedSearchResponseItem,
} from '../../../generated/search/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import { CalendarEvent } from '../calendar/event';
import { CallRecord } from '../calls/call-record';
import { Channel } from '../channels/channel';
import { Message } from '../channels/message';
import { Chat } from '../chats/chat';
import { Company } from '../crm/company';
import { Document } from '../documents/document';
import { EmailThread } from '../email/thread';
import { Project } from '../projects/project';
import { visibleTags } from '../workspace/items';
import { WorkspaceQuery } from '../workspace/query';
import type { WorkspaceTag } from '../workspace/types';
import type {
  SearchOptions,
  SearchPage,
  SearchPageOptions,
  SearchResult,
  SearchType,
} from './types';

const nil = '00000000-0000-0000-0000-000000000000';

const DEFAULT_PAGE_SIZE = 50;

/** How each kind is left out of a search: a nil id in its primary filter. */
const exclusions: Record<
  Exclude<SearchType, 'company'>,
  (filters: EntityFilters) => EntityFilters
> = {
  agent_session: (f) => ({
    ...f,
    agent_session_filters: { ...f.agent_session_filters, ids: [nil] },
  }),
  document: (f) => ({ ...f, document_filters: { document_ids: [nil] } }),
  chat: (f) => ({ ...f, chat_filters: { chat_ids: [nil] } }),
  email: (f) => ({
    ...f,
    email_filters: { ...f.email_filters, email_thread_ids: [nil] },
  }),
  channel: (f) => ({ ...f, channel_filters: { channel_ids: [nil] } }),
  project: (f) => ({ ...f, project_filters: { project_ids: [nil] } }),
  call: (f) => ({ ...f, call_filters: { channel_ids: [nil] } }),
  calendar_event: (f) => ({
    ...f,
    calendar_event_filters: { calendar_event_ids: [nil] },
  }),
};

const searchTypes: readonly SearchType[] = [
  ...(Object.keys(exclusions) as SearchType[]),
  'company',
];

/**
 * Search the user's Macro content across every kind of item in one call:
 * documents and tasks, email, channels and their messages, projects, call
 * transcripts, calendar events, agent session transcripts, AI chats, and CRM
 * companies when asked for. Results come most relevant first, as typed entity
 * handles, with the same filters as the per-type searches and more: exact
 * matching, tags, one inbox and agent session transcripts.
 *
 * @routing Use when finding or looking up the user's own Macro content by keyword, across types or in one; not browsing recent items (`macro.workspace`), the web, or one item already in context.
 *
 * @agent
 * Search is keyword search, not semantic: pass 1-3 words that would literally appear in the item, not the user's description. Whitespace-separated terms are ANDed; for documents and email each word is a prefix and terms may match different passages, while for other kinds the query is one adjacent phrase prefix, so long phrases match nothing. Quote a multi-word phrase; use matchType 'exact' for a whole word, identifier or email address. Search a person and a topic separately. To find someone's email, search their quoted address, not their name.
 *
 * Use macro.search.all(query) when the request does not name one kind of item, and keep any scope the user gives (types, inbox, tags) on follow-ups and retries. Per-type searches remain for one kind: macro.documents.search returns document handles, macro.email.search email threads, macro.tasks.search tasks. SearchOpts and SearchOptions select searchOn: 'name', 'content', or 'name_content'. These iterators auto-paginate; bound the work explicitly and record when you stop before exhaustion.
 *
 * For activity rather than keywords ("what happened today", "catch me up", my recent or favorite items, tasks updated this week), browse with macro.workspace.page or macro.workspace.list, filtered by type, time, tags or inbox; for a sample of several kinds, fetch one small page per type concurrently. Read an AI chat's messages with macro.chats.byId(id).history(), or chat.history() on a search or workspace result.
 *
 * ```javascript
 * export async function main({macro}) {
 *   const queries = ['launch decision', 'release readiness'];
 *   const outcomes = await Promise.allSettled(queries.map(async query => {
 *     const evidence = [];
 *     let stoppedEarly = false;
 *     for await (const result of macro.search.all(query, {searchOn:'content'})) {
 *       if (evidence.length === 5) { stoppedEarly = true; break; }
 *       evidence.push({type:result.type, id:result.entity.id, name:result.hit.name,
 *         text: result.type === 'document' ? (await result.entity.content()).slice(0,3000) : undefined});
 *     }
 *     return {query,evidence,stoppedEarly};
 *   }));
 *   return {data: outcomes.map((item,index) => item.status === 'fulfilled'
 *     ? item.value : {query:queries[index],error:String(item.reason)}), reviews:[]};
 * }
 * ```
 * Preserve useful evidence from each query. A short sample cannot establish corpus-wide completeness or absence. Use precise terms, metadata and relevant reads before expanding breadth. Do not swallow rejected branches. Normal for/while/for-await with break and sequential dependent calls are supported.
 *
 * Skills are instructions to follow. When a request names a skill that is not attached, find it by name with macro.documents.skills({query}), which includes built-in skills, read its instructions with skill.content() before doing the task, and follow them for that request only.
 *
 * @example Find a contract across email and documents, in one inbox
 * ```js
 * const page = await macro.search.page('"master services agreement"', {
 *   types: ['email', 'document'], inbox: 'me@example.com', matchType: 'exact',
 * });
 * return {data: page.results.map(r => ({type: r.type, id: r.entity.id, tags: r.tags})),
 *   hasMore: page.hasMore};
 * ```
 */
export class SearchNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * One bounded page of matches across every kind of item, most relevant
   * first; resume with `nextCursor` and the same options.
   *
   * @readonly
   */
  async page(
    query: string,
    options: SearchPageOptions = {},
  ): Promise<SearchPage> {
    const scope = new WorkspaceQuery(this.client);
    return this.fetch(
      scope,
      await this.request(scope, query, options),
      options,
      options.cursor,
    );
  }

  /**
   * Every match across every kind of item, most relevant first, auto-paginated.
   * Break a `for await` loop to stop; no further page is fetched.
   *
   * @readonly
   */
  async *all(
    query: string,
    options: SearchOptions = {},
  ): AsyncGenerator<SearchResult> {
    const scope = new WorkspaceQuery(this.client);
    const body = await this.request(scope, query, options);
    yield* paginate(async (cursor) => {
      const page = await this.fetch(scope, body, options, cursor);
      return { items: page.results, nextCursor: page.nextCursor };
    });
  }

  private async request(
    scope: WorkspaceQuery,
    query: string,
    options: SearchOptions,
  ): Promise<UnifiedSearchRequest> {
    validate(query, options);
    const [link, tags] = await Promise.all([
      scope.inbox(options.inbox),
      scope.tags(options.tags, options.tagsMatch),
    ]);
    let filters: EntityFilters = {
      ...(link ? { email_filters: { link_ids: [link.id] } } : {}),
      ...(tags.length
        ? {
            tag_option_ids: tags.map((tag) => tag.id),
            tag_filter_mode: options.tagsMatch ?? 'any',
          }
        : {}),
    };
    // Named sessions alone, whatever the types; otherwise the requested types.
    const sessions = options.agentSessions ?? [];
    const types: readonly SearchType[] = sessions.length
      ? ['agent_session']
      : (options.types ?? []);
    if (!types.length) {
      filters.agent_session_filters = { include: true };
    } else {
      for (const [type, exclude] of Object.entries(exclusions))
        if (!types.includes(type as SearchType)) filters = exclude(filters);
      if (types.includes('agent_session'))
        filters.agent_session_filters = {
          include: true,
          ...(sessions.length
            ? { ids: sessions.map((session) => session.id) }
            : {}),
        };
    }
    return {
      query,
      match_type: options.matchType ?? 'partial',
      search_on: options.searchOn ?? 'name_content',
      filters,
      ...(types.includes('company') ? { include_crm: true } : {}),
      ...(options.calendarScope
        ? { calendar_event_scope: options.calendarScope }
        : {}),
    };
  }

  private async fetch(
    scope: WorkspaceQuery,
    body: UnifiedSearchRequest,
    options: SearchOptions,
    cursor?: string,
  ): Promise<SearchPage> {
    const { results, next_cursor } = unwrap(
      await this.client.search.unifiedSearch({
        body,
        query: {
          page_size: options.pageSize ?? DEFAULT_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        },
      }),
    );
    const tagged = results.some((hit) =>
      propertiesOf(hit).some(
        (property) => property.definition.data_type === 'TAG',
      ),
    );
    const tagMap = tagged ? await scope.tagMap() : new Map();
    return {
      results: results.map((hit) => searchResult(this.client, hit, tagMap)),
      nextCursor: next_cursor,
      hasMore: next_cursor != null,
    };
  }
}

/** Fail on a JavaScript caller's typo before it silently broadens the search. */
function validate(query: string, options: SearchOptions) {
  if (!query.trim()) throw new Error('Search query must not be empty.');
  if (
    options.types !== undefined &&
    (!Array.isArray(options.types) ||
      options.types.some((type) => !searchTypes.includes(type)))
  )
    throw new Error(
      `Invalid search types. Supported values: ${searchTypes.join(', ')}. Tasks are documents.`,
    );
  for (const [name, value, allowed] of [
    ['searchOn', options.searchOn, ['name', 'content', 'name_content']],
    ['matchType', options.matchType, ['partial', 'exact']],
    ['tagsMatch', options.tagsMatch, ['any', 'all']],
    ['calendarScope', options.calendarScope, ['own', 'shared_with_you']],
  ] as const) {
    if (value !== undefined && !(allowed as readonly string[]).includes(value))
      throw new Error(`Invalid search ${name}: ${value}`);
  }
}

function propertiesOf(hit: UnifiedSearchResponseItem) {
  return ('properties' in hit ? hit.properties : undefined) ?? [];
}

function searchResult(
  client: MacroClient,
  hit: UnifiedSearchResponseItem,
  tagMap: Map<string, WorkspaceTag>,
): SearchResult {
  const tags = visibleTags(propertiesOf(hit), tagMap);
  return match(hit)
    .returnType<SearchResult>()
    .with({ type: 'document' }, (hit) => ({
      type: 'document',
      entity: Document.byId(client, hit.document_id),
      hit,
      tags,
    }))
    .with({ type: 'email' }, (hit) => ({
      type: 'email',
      entity: EmailThread.byId(client, hit.thread_id),
      hit,
      tags,
    }))
    .with({ type: 'channel' }, (hit) => ({
      type: 'channel',
      entity: Channel.byId(client, hit.channel_id),
      hit,
      tags,
    }))
    .with({ type: 'channelMessage' }, (hit) => ({
      type: 'channel_message',
      entity: Message.byId(client, hit.channel_id, hit.message_id),
      channel: Channel.byId(client, hit.channel_id),
      hit,
      tags,
    }))
    .with({ type: 'project' }, (hit) => ({
      type: 'project',
      entity: Project.byId(client, hit.id),
      hit,
      tags,
    }))
    .with({ type: 'call' }, (hit) => ({
      type: 'call',
      entity: CallRecord.byId(client, hit.call_id),
      hit,
      tags,
    }))
    .with({ type: 'calendarEvent' }, (hit) => ({
      type: 'calendar_event',
      entity: CalendarEvent.byId(client, hit.id),
      hit,
      tags,
    }))
    .with({ type: 'agentSession' }, (hit) => ({
      type: 'agent_session',
      entity: AgentSession.byId(client, hit.id),
      hit,
      tags,
    }))
    .with({ type: 'chat' }, (hit) => ({
      type: 'chat',
      entity: Chat.byId(client, hit.chat_id),
      hit,
      tags,
    }))
    .with({ type: 'company' }, (hit) => ({
      type: 'company',
      entity: Company.byId(client, hit.id),
      hit,
      tags,
    }))
    .exhaustive();
}
