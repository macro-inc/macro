import { thrownResultErrorHasCode } from '@core/util/result';
import { CombinedError } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { channelParticipantsQueryOptions } from './channel-participants';

const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
}));

const rest = vi.hoisted(() => ({ getChannelParticipants: vi.fn() }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: rest }));

const spans = vi.hoisted(() => [] as { name: string; attributes: unknown }[]);
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    span: async (
      name: string,
      options: { attributes: unknown },
      run: (span: { error: () => void }) => Promise<unknown>
    ) => {
      spans.push({ name, attributes: options.attributes });
      return await run({ error: () => {} });
    },
  },
}));

const CHANNEL = '01a1fb77-4862-7455-a615-34d2f8177a61';

function respond(items: unknown[]) {
  network.query.mockReturnValueOnce({
    toPromise: async () => ({
      data: { user: { id: 'viewer', soup: { items } } },
      error: undefined,
    }),
  });
}

function participant(userId: string, joinedAt: string, overrides = {}) {
  return {
    channelId: CHANNEL,
    userId,
    role: 'member',
    joinedAt,
    leftAt: null,
    ...overrides,
  };
}

const read = () => channelParticipantsQueryOptions(CHANNEL).queryFn();

beforeEach(() => {
  vi.clearAllMocks();
  spans.length = 0;
});

it('reads the channel by id over the network and returns the REST shape', async () => {
  respond([
    {},
    {
      id: CHANNEL,
      participants: [
        participant('macro|b', '2026-01-02T00:00:00.000002+00:00'),
        participant('macro|a', '2026-01-01T00:00:00.000001+00:00', {
          role: 'owner',
        }),
        participant('macro|gone', '2026-01-01T12:00:00+00:00', {
          leftAt: '2026-01-03T00:00:00+00:00',
        }),
      ],
    },
  ]);

  expect(await read()).toEqual([
    {
      channel_id: CHANNEL,
      user_id: 'macro|a',
      role: 'owner',
      joined_at: '2026-01-01T00:00:00.000001Z',
    },
    {
      channel_id: CHANNEL,
      user_id: 'macro|b',
      role: 'member',
      joined_at: '2026-01-02T00:00:00.000002Z',
    },
  ]);
  const [, variables, context] = network.query.mock.calls[0];
  expect(JSON.stringify(variables)).toContain(CHANNEL);
  expect(context).toEqual({ requestPolicy: 'network-only' });
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
  expect(spans).toEqual([]);
});

it('returns an empty roster when the channel has nobody', async () => {
  respond([{ id: CHANNEL, participants: [] }]);
  expect(await read()).toEqual([]);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
});

it('reads REST, traced, when the soup does not return the channel', async () => {
  respond([]);
  const rows = [
    {
      channel_id: CHANNEL,
      user_id: 'macro|a',
      role: 'member',
      joined_at: '2026-01-01T00:00:00Z',
    },
  ];
  rest.getChannelParticipants.mockResolvedValueOnce(ok(rows));

  expect(await read()).toEqual(rows);
  expect(rest.getChannelParticipants).toHaveBeenCalledWith({
    channel_id: CHANNEL,
  });
  expect(spans).toEqual([
    {
      name: 'soup.rest_fallback',
      attributes: expect.objectContaining({
        'soup.fallback.reason': 'channel not in soup',
        'channel.id': CHANNEL,
      }),
    },
  ]);
});

it('rejects with the REST error when the fallback fails', async () => {
  respond([]);
  rest.getChannelParticipants.mockResolvedValueOnce(
    err([{ code: 'NOT_FOUND', message: 'gone' }])
  );
  const error = await read().catch((caught: unknown) => caught);
  expect(thrownResultErrorHasCode(error, 'NOT_FOUND')).toBe(true);
});

it('rejects on a GraphQL failure without reading REST', async () => {
  network.query.mockReturnValueOnce({
    toPromise: async () => ({
      data: undefined,
      error: new CombinedError({
        networkError: new Error('down'),
        response: { status: 401 },
      }),
    }),
  });
  const error = await read().catch((caught: unknown) => caught);
  expect(thrownResultErrorHasCode(error, 'UNAUTHORIZED')).toBe(true);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();

  network.query.mockReturnValueOnce({
    toPromise: async () => ({
      data: undefined,
      error: new CombinedError({ graphQLErrors: ['boom'] }),
    }),
  });
  await expect(read()).rejects.toBeInstanceOf(CombinedError);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
});
