import { thrownResultErrorHasCode } from '@core/util/result';
import { Client, CombinedError, fetchExchange } from '@urql/core';
import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { channelParticipantsQueryOptions } from './channel-participants';

const network = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupNetworkClient: () => network,
}));

const rest = vi.hoisted(() => ({ getChannelParticipants: vi.fn() }));
vi.mock('@service-storage/client', () => ({ storageServiceClient: rest }));

const spans = vi.hoisted(
  () => [] as { name: string; attributes: unknown; inParent: boolean }[]
);
const trace = vi.hoisted(() => ({ inParent: false }));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    captureContext: () => ({
      run: <T>(operation: () => T) => {
        trace.inParent = true;
        try {
          return operation();
        } finally {
          trace.inParent = false;
        }
      },
    }),
    span: async (
      name: string,
      options: { attributes: unknown },
      run: (span: { error: () => void }) => Promise<unknown>
    ) => {
      spans.push({
        name,
        attributes: options.attributes,
        inParent: trace.inParent,
      });
      return await run({ error: () => {} });
    },
  },
}));

const CHANNEL = '01a1fb77-4862-7455-a615-34d2f8177a61';

/** An urql result source that answers once, a tick after it is subscribed. */
function answer(result: unknown) {
  const unsubscribe = vi.fn();
  network.query.mockReturnValueOnce({
    subscribe: (onResult: (value: unknown) => void) => {
      setTimeout(() => {
        if (!unsubscribe.mock.calls.length) onResult(result);
      });
      return { unsubscribe };
    },
  });
  return unsubscribe;
}

function respond(soupEntity: unknown) {
  return answer({
    data: { user: { id: 'viewer', soupEntity } },
    error: undefined,
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

const read = (signal = new AbortController().signal) =>
  channelParticipantsQueryOptions(CHANNEL).queryFn({ signal });

/** What the read rejected with, or undefined when it resolved. */
async function rejection(reading: Promise<unknown>): Promise<unknown> {
  try {
    await reading;
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  spans.length = 0;
});

it('reads the channel by id over the network and returns the REST shape', async () => {
  const unsubscribe = respond({
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
  });

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
  expect(variables).toEqual({
    input: { entityType: 'CHANNEL', entityId: CHANNEL },
  });
  expect(context).toEqual({ requestPolicy: 'network-only' });
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
  expect(spans).toEqual([]);
});

it('orders people who joined in the same millisecond by the microsecond', async () => {
  respond({
    id: CHANNEL,
    participants: [
      participant('macro|later', '2026-01-01T00:00:00.000900+00:00'),
      participant('macro|earlier', '2026-01-01T00:00:00.000100+00:00'),
      participant('macro|first', '2026-01-01T00:00:00+00:00'),
    ],
  });
  expect((await read()).map((row) => row.user_id)).toEqual([
    'macro|first',
    'macro|earlier',
    'macro|later',
  ]);
});

it('tears the read down when the query cancels it', async () => {
  const unsubscribe = respond({ id: CHANNEL, participants: [] });
  const controller = new AbortController();
  const reading = rejection(read(controller.signal));
  controller.abort(new Error('cancelled'));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(await reading).toEqual(new Error('cancelled'));
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
});

it('sends its own request when it replaces a read the query cancelled', async () => {
  const roster = (userId: string) =>
    new Response(
      JSON.stringify({
        data: {
          user: {
            id: 'viewer',
            soupEntity: {
              id: CHANNEL,
              participants: [participant(userId, '2026-01-01T00:00:00+00:00')],
            },
          },
        },
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  const beforeWrite = Promise.withResolvers<Response>();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockReturnValueOnce(beforeWrite.promise)
    .mockResolvedValueOnce(roster('macro|after'));
  const client = new Client({
    url: 'https://dss.test/graphql',
    exchanges: [fetchExchange],
    fetch,
  });
  network.query.mockImplementation(client.query.bind(client));

  const controller = new AbortController();
  const cancelled = rejection(read(controller.signal));
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort(new Error('cancelled'));
  const replacement = read();
  beforeWrite.resolve(roster('macro|before'));
  await cancelled;

  expect((await replacement).map((row) => row.user_id)).toEqual([
    'macro|after',
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('returns an empty roster when the channel has nobody', async () => {
  respond({ id: CHANNEL, participants: [] });
  expect(await read()).toEqual([]);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
});

it('reads REST, traced, when the soup does not return the channel', async () => {
  respond(null);
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
      inParent: true,
    },
  ]);
});

it('rejects with the REST error when the fallback fails', async () => {
  respond(null);
  rest.getChannelParticipants.mockResolvedValueOnce(
    err([{ code: 'NOT_FOUND', message: 'gone' }])
  );
  const error = await rejection(read());
  expect(thrownResultErrorHasCode(error, 'NOT_FOUND')).toBe(true);
});

it('rejects on a GraphQL failure without reading REST', async () => {
  answer({
    data: undefined,
    error: new CombinedError({
      networkError: new Error('down'),
      response: { status: 401 },
    }),
  });
  const error = await rejection(read());
  expect(thrownResultErrorHasCode(error, 'UNAUTHORIZED')).toBe(true);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();

  answer({
    data: undefined,
    error: new CombinedError({
      graphQLErrors: ['authentication required'],
      response: { status: 200 },
    }),
  });
  expect(
    thrownResultErrorHasCode(await rejection(read()), 'UNAUTHORIZED')
  ).toBe(true);

  answer({
    data: undefined,
    error: new CombinedError({ graphQLErrors: ['boom'] }),
  });
  await expect(read()).rejects.toBeInstanceOf(CombinedError);
  expect(rest.getChannelParticipants).not.toHaveBeenCalled();
});
