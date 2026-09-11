import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients = vi.hoisted(() => ({
  graphql: vi.fn(),
  preview: vi.fn(),
  soup: vi.fn(),
  bots: vi.fn(),
  bot: vi.fn(),
}));
vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  QUERY_FILTERS_BASE: { document_filters: { document_ids: ['excluded'] } },
}));
vi.mock('@service-storage/agent-session-mentions', () => ({
  fetchGraphqlAgentSessionMentions: clients.graphql,
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { preview: clients.preview },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getSoupItems: clients.soup,
    getBots: clients.bots,
    getBot: clients.bot,
  },
}));
vi.mock('../client', () => ({
  queryClient: {
    ensureQueryData: ({ queryFn }: { queryFn: () => unknown }) => queryFn(),
  },
}));

import {
  agentSessionMentionInput,
  fetchAgentSessionMentionPreviews,
  fetchRecentAgentSessionMentions,
} from './mention-fetchers';

beforeEach(() => vi.clearAllMocks());
const session = {
  id: 'one',
  name: 'Fix menu',
  botId: 'bot',
  ownerId: 'owner',
  createdAt: '',
  updatedAt: '',
  status: 'session/end',
  bot: { id: 'bot', name: 'Ada', avatarUrl: null },
};

describe('mention transport adapters', () => {
  it('opts into sessions and excludes other Soup entity types', () => {
    const input = agentSessionMentionInput();
    expect(input.initial?.limit).toBe(500);
    expect(input.initial?.filters?.agentSessionFilter).toEqual({
      literal: { include: true },
    });
    expect(input.initial?.filters?.documentFilter).toEqual({
      literal: { id: '00000000-0000-0000-0000-000000000000' },
    });
    expect(
      agentSessionMentionInput(['one', 'two']).initial?.filters
        ?.agentSessionFilter
    ).toEqual({
      or: {
        left: { literal: { id: 'one' } },
        right: { literal: { id: 'two' } },
      },
    });
  });
  it('uses GraphQL metadata without a REST waterfall for accessible sessions', async () => {
    clients.graphql.mockResolvedValue([session]);
    const result = await fetchAgentSessionMentionPreviews(['one'], true);
    expect(result.get('one')).toMatchObject({
      access: 'access',
      data: {
        bot: session.bot,
        status: { kind: 'event', event: 'session/end' },
      },
    });
    expect(clients.preview).not.toHaveBeenCalled();
    expect(clients.bot).not.toHaveBeenCalled();
  });
  it('uses REST to distinguish inaccessible and deleted GraphQL omissions', async () => {
    clients.graphql.mockResolvedValue([session]);
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          { id: 'private', type: 'no_access' },
          { id: 'deleted', type: 'does_not_exist' },
        ],
      })
    );
    const result = await fetchAgentSessionMentionPreviews(
      ['one', 'private', 'deleted'],
      true
    );
    expect(clients.preview).toHaveBeenCalledWith(['private', 'deleted']);
    expect(result.get('private')).toEqual({ access: 'no_access' });
    expect(result.get('deleted')).toEqual({ access: 'does_not_exist' });
    expect(clients.bot).not.toHaveBeenCalled();
  });
  it('hydrates REST previews with persona metadata and normalized timestamps', async () => {
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          {
            ...session,
            type: 'access',
            modifiedAt: 'updated',
            status: { kind: 'no_messages' },
          },
        ],
      })
    );
    clients.bot.mockResolvedValue(
      ok({ id: 'bot', name: 'Ada', avatar_url: 'avatar' })
    );
    const result = await fetchAgentSessionMentionPreviews(['one'], false);
    expect(result.get('one')).toMatchObject({
      access: 'access',
      data: { updatedAt: 'updated', bot: { name: 'Ada', avatarUrl: null } },
    });
    expect(clients.graphql).not.toHaveBeenCalled();
  });
  it('hydrates REST discovery through permission-checked previews', async () => {
    clients.soup.mockResolvedValue(
      ok({ items: [{ tag: 'agentSession', data: session }] })
    );
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          {
            ...session,
            type: 'access',
            modifiedAt: '',
            status: { kind: 'no_messages' },
          },
        ],
      })
    );
    expect(await fetchRecentAgentSessionMentions(false)).toMatchObject([
      { id: 'one', bot: { name: 'Ada' } },
    ]);
    expect(clients.bot).not.toHaveBeenCalled();
    expect(clients.soup).toHaveBeenCalledWith({
      params: {},
      body: {
        document_filters: { document_ids: ['excluded'] },
        agent_session_filters: { include: true },
        limit: 500,
        sort_method: 'updated_at',
      },
    });
  });
  it('resolves a persona from botId when the REST preview omits bot metadata', async () => {
    clients.soup.mockResolvedValue(
      ok({
        items: [{ tag: 'agentSession', data: { ...session, bot: undefined } }],
      })
    );
    clients.preview.mockResolvedValue(
      ok({
        previews: [
          {
            ...session,
            bot: undefined,
            type: 'access',
            modifiedAt: '',
            status: { kind: 'no_messages' },
          },
        ],
      })
    );
    clients.bots.mockResolvedValue(
      ok([{ id: 'bot', name: 'cursor', avatar_url: null }])
    );
    expect(await fetchRecentAgentSessionMentions(false)).toMatchObject([
      { id: 'one', bot: { id: 'bot', name: 'cursor' } },
    ]);
    expect(clients.bots).toHaveBeenCalledOnce();
  });

  it('resolves missing GraphQL persona metadata from the same cached bot list', async () => {
    clients.graphql.mockResolvedValue([{ ...session, bot: null }]);
    clients.bots.mockResolvedValue(
      ok([{ id: 'bot', name: 'cursor', avatar_url: null }])
    );
    expect(await fetchRecentAgentSessionMentions(true)).toMatchObject([
      { id: 'one', bot: { name: 'cursor' } },
    ]);
    expect(clients.preview).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'resolves built-in personas without the manageable bots list (GraphQL: %s)',
    async (graphql) => {
      const sessions = [
        {
          ...session,
          id: 'cursor',
          botId: '00000000-0000-0000-0000-00000000c5c5',
          bot: undefined,
        },
        {
          ...session,
          id: 'macro-new',
          botId: '00000000-0000-0000-0000-00000000a2a2',
          bot: undefined,
        },
      ];
      clients.graphql.mockResolvedValue(sessions);
      clients.soup.mockResolvedValue(
        ok({ items: sessions.map((data) => ({ tag: 'agentSession', data })) })
      );
      clients.preview.mockResolvedValue(
        ok({
          previews: sessions.map((data) => ({
            ...data,
            type: 'access',
            modifiedAt: '',
            status: { kind: 'no_messages' },
          })),
        })
      );
      expect(await fetchRecentAgentSessionMentions(graphql)).toMatchObject([
        { id: 'cursor', bot: { name: 'Cursor' } },
        { id: 'macro-new', bot: { name: 'macro(new)' } },
      ]);
      expect(clients.bots).not.toHaveBeenCalled();
    }
  );

  it('preserves API names and built-in names when custom persona lookup fails', async () => {
    clients.graphql.mockResolvedValue([
      {
        ...session,
        id: 'renamed',
        botId: '00000000-0000-0000-0000-00000000c5c5',
        bot: {
          id: '00000000-0000-0000-0000-00000000c5c5',
          name: 'API persona',
        },
      },
      {
        ...session,
        id: 'macro-new',
        botId: '00000000-0000-0000-0000-00000000a2a2',
        bot: null,
      },
      { ...session, bot: null },
    ]);
    clients.bots.mockResolvedValue(err(new Error('unavailable')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await fetchRecentAgentSessionMentions(true)).toMatchObject([
        { id: 'renamed', bot: { name: 'API persona' } },
        { id: 'macro-new', bot: { name: 'macro(new)' } },
        { id: 'one', bot: null },
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps sessions visible when the optional persona lookup fails', async () => {
    clients.graphql.mockResolvedValue([{ ...session, bot: null }]);
    clients.bots.mockResolvedValue(err(new Error('unavailable')));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await fetchRecentAgentSessionMentions(true)).toMatchObject([
        { id: 'one', bot: null },
      ]);
    } finally {
      warn.mockRestore();
    }
  });
});
