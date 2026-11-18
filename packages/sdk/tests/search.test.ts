import { afterEach, expect, test } from 'bun:test';
import type { TagSetResponse } from '../generated/properties/types.gen';
import { AgentSession } from '../src/entities/agent-sessions/agent-session';
import { CalendarEvent } from '../src/entities/calendar/event';
import { Message } from '../src/entities/channels/message';
import { Chat } from '../src/entities/chats/chat';
import { Document } from '../src/entities/documents/document';
import { EmailThread } from '../src/entities/email/thread';
import { Macro } from '../src/macro';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const nil = '00000000-0000-0000-0000-000000000000';
const macro = () =>
  new Macro({
    token: 'test-token',
    hosts: {
      search: 'https://search.test',
      properties: 'https://properties.test',
      email: 'https://email.test',
    },
  });

function serve(handler: (request: Request) => Response | Promise<Response>) {
  globalThis.fetch = (async (input) =>
    handler(
      input instanceof Request ? input : new Request(input),
    )) as typeof fetch;
}

const tagSets = [
  {
    scope: 'user',
    definition: { id: 'personal-def' },
    options: [
      { id: 'personal-option', value: { type: 'string', value: 'Launch' } },
    ],
  },
] as TagSetResponse[];

const tagProperty = (option: string) => ({
  definition: { data_type: 'TAG' },
  value: { type: 'SelectOption', value: [option] },
});

test('searches every type in one call and returns a typed handle per hit', async () => {
  const requests: { url: URL; body: unknown }[] = [];
  serve(async (request) => {
    const url = new URL(request.url);
    requests.push({ url, body: await request.json() });
    expect(url.pathname).toBe('/search');
    expect(request.headers.get('authorization')).toBe('Bearer test-token');
    if (url.searchParams.get('cursor') === 'next')
      return Response.json({
        results: [
          {
            type: 'chat',
            chat_id: 'chat',
            id: 'chat',
            name: 'Plan chat',
          },
        ],
      });
    return Response.json({
      results: [
        { type: 'document', document_id: 'doc', id: 'doc', name: 'Plan' },
        { type: 'email', thread_id: 'thread', id: 'thread' },
        {
          type: 'channelMessage',
          channel_id: 'channel',
          message_id: 'message',
          id: 'message',
        },
        {
          type: 'calendarEvent',
          id: 'event',
          name: 'Planning',
          calendar_event_search_results: [],
        },
        { type: 'agentSession', id: 'session', name: 'Plan session' },
      ],
      next_cursor: 'next',
    });
  });

  const results = [];
  for await (const result of macro().search.all('plan')) results.push(result);

  expect(requests.map(({ url }) => url.search)).toEqual([
    '?page_size=50',
    '?page_size=50&cursor=next',
  ]);
  expect(requests[0]?.body).toEqual({
    query: 'plan',
    match_type: 'partial',
    search_on: 'name_content',
    filters: { agent_session_filters: { include: true } },
  });
  expect(results.map((result) => result.type)).toEqual([
    'document',
    'email',
    'channel_message',
    'calendar_event',
    'agent_session',
    'chat',
  ]);
  const [document, email, message, event, session, chat] = results;
  expect(document?.entity).toBeInstanceOf(Document);
  expect(document?.entity.id).toBe('doc');
  expect(email?.entity).toBeInstanceOf(EmailThread);
  expect(message?.entity).toBeInstanceOf(Message);
  if (message?.type !== 'channel_message') throw new Error('expected message');
  expect(message.entity.channelId).toBe('channel');
  expect(message.channel.id).toBe('channel');
  expect(event?.entity).toBeInstanceOf(CalendarEvent);
  if (event?.type !== 'calendar_event') throw new Error('expected event');
  expect(event.hit.name).toBe('Planning');
  expect(session?.entity).toBeInstanceOf(AgentSession);
  expect(chat?.entity).toBeInstanceOf(Chat);
  expect(chat?.tags).toEqual([]);
});

test('scopes to types, exact matching, an inbox and tags, and labels hit tags', async () => {
  const paths: string[] = [];
  serve(async (request) => {
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.hostname === 'properties.test') return Response.json(tagSets);
    if (url.pathname.endsWith('/links'))
      return Response.json({
        links: [{ id: 'work-link', email_address: 'Me@Example.com' }],
      });
    expect(url.search).toBe('?page_size=10');
    expect(await request.json()).toEqual({
      query: '"launch plan"',
      match_type: 'exact',
      search_on: 'content',
      filters: {
        agent_session_filters: { ids: [nil] },
        chat_filters: { chat_ids: [nil] },
        channel_filters: { channel_ids: [nil] },
        project_filters: { project_ids: [nil] },
        call_filters: { channel_ids: [nil] },
        calendar_event_filters: { calendar_event_ids: [nil] },
        email_filters: { link_ids: ['work-link'] },
        tag_option_ids: ['personal-option'],
        tag_filter_mode: 'all',
      },
      calendar_event_scope: 'shared_with_you',
    });
    return Response.json({
      results: [
        {
          type: 'document',
          document_id: 'doc',
          id: 'doc',
          properties: [tagProperty('personal-option'), tagProperty('other')],
        },
      ],
    });
  });

  const page = await macro().search.page('"launch plan"', {
    types: ['document', 'email'],
    searchOn: 'content',
    matchType: 'exact',
    inbox: ' me@example.com ',
    tags: [{ label: ' launch ' }],
    tagsMatch: 'all',
    calendarScope: 'shared_with_you',
    pageSize: 10,
  });

  expect(page.hasMore).toBe(false);
  expect(page.results[0]?.tags).toEqual([
    { label: 'Launch', scope: 'personal' },
  ]);
  // Tag sets are read once for both the filter and the labels.
  expect(paths.filter((path) => path === '/properties/tags')).toHaveLength(1);
});

test('agent session scope searches only those transcripts', async () => {
  serve(async (request) => {
    expect(await request.json()).toMatchObject({
      filters: {
        agent_session_filters: { include: true, ids: ['session'] },
        document_filters: { document_ids: [nil] },
        email_filters: { email_thread_ids: [nil] },
        chat_filters: { chat_ids: [nil] },
      },
    });
    return Response.json({ results: [] });
  });
  const client = macro();
  await client.search.page('deploy', {
    agentSessions: [client.agentSessions.byId('session')],
    types: ['document'],
  });
});

test('companies are searched only when asked for', async () => {
  serve(async (request) => {
    expect(await request.json()).toMatchObject({ include_crm: true });
    return Response.json({
      results: [{ type: 'company', id: 'acme', name: 'Acme' }],
    });
  });
  const page = await macro().search.page('acme', { types: ['company'] });
  expect(page.results[0]?.type).toBe('company');
  expect(page.results[0]?.entity.id).toBe('acme');
});

test('rejects an empty query, an unknown type and an unknown tag before searching', async () => {
  let searches = 0;
  serve((request) => {
    if (new URL(request.url).hostname === 'properties.test')
      return Response.json(tagSets);
    searches++;
    return Response.json({ results: [] });
  });
  await expect(macro().search.page('  ')).rejects.toThrow(
    'Search query must not be empty',
  );
  await expect(
    // @ts-expect-error an unsupported type
    macro().search.page('plan', { types: ['spreadsheet'] }),
  ).rejects.toThrow('Invalid search types');
  await expect(
    macro().search.page('plan', { tags: [{ label: 'Missing' }] }),
  ).rejects.toThrow('Unknown tag "Missing". Available tags: Launch (personal)');
  expect(searches).toBe(0);
});
