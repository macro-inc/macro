import { thrownResultErrorHasCode } from '@core/util/result';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { CacheHost } from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { createClient, fetchExchange } from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelMessageKey } from '../channel-map';
import { createChannelWrites } from '../channel-writes';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import { NOW, send, writeHost, written } from './write-fixtures';

/** The code a write failed with, or `delivered`. */
const outcome = async (write: Promise<unknown>): Promise<string> => {
  try {
    await write;
    return 'delivered';
  } catch (error) {
    const code = ['CACHE_RETIRED', 'DELIVERY_UNKNOWN', 'NOT_QUEUED'].find(
      (name) => thrownResultErrorHasCode(error, name)
    );
    return code ?? String(error);
  }
};

const json = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    headers: { 'content-type': 'application/json' },
  });

const edit = (message: ChannelMessageFieldsFragment, content = 'edited') => ({
  channelId: CHANNEL_ID,
  id: message.id,
  content,
  mentions: [],
  removeAttachmentIds: [],
  addAttachments: [],
});

const TRANSACTION_ID = '1';
const WRITE_RESULT = {
  revision: INITIAL_CACHE_REVISION,
  revisionAdvanced: true,
  changed: [],
  affectedOps: [],
  reset: false,
};

/** The queue's answer to a write it starts on at once. */
const claimed: CacheHost['enqueueOptimisticMutation'] = async (args) => ({
  ...WRITE_RESULT,
  transactionId: TRANSACTION_ID,
  upsertKind: { kind: 'inserted' },
  initialClaim: {
    kind: 'claimed',
    mutation: {
      transactionId: TRANSACTION_ID,
      uuid: args.uuid,
      superseded: false,
      requiresConfirmation: false,
      leaseGeneration: '1',
      query: args.query,
      operationName: args.operationName,
      variables: args.variables ?? {},
      attemptCount: 1,
      serverFailureCount: 0,
    },
  },
});

type Request = {
  id: string;
  signal: AbortSignal | undefined;
  answer: (response: Response) => void;
};

const lifetimes: AbortController[] = [];

/** Writes through the real exchange and transport, over a queue to script. */
function setup(
  enqueueOptimisticMutation: CacheHost['enqueueOptimisticMutation'],
  records: ChannelMessageFieldsFragment[] = []
) {
  const device = writeHost(records);
  const lifetime = new AbortController();
  lifetimes.push(lifetime);
  let signIn = 1;
  const host: CacheHost = {
    ...createNoopCacheHost(),
    ...device.host,
    get paused() {
      return device.availability.paused;
    },
    disabled: false,
    enqueueOptimisticMutation,
  };
  const requests: Request[] = [];
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [
      normalizedCacheExchange(host, { signal: lifetime.signal }),
      fetchExchange,
    ],
    preferGetMethod: false,
    fetch: (_input, init) => {
      const { variables } = JSON.parse(String(init?.body));
      const answered = Promise.withResolvers<Response>();
      requests.push({
        id: variables.input.id,
        signal: init?.signal ?? undefined,
        answer: answered.resolve,
      });
      return answered.promise;
    },
  });
  const writes = createChannelWrites({
    host,
    runtime: { notifyChanged: () => undefined },
    client: () => client,
    signIn: () => signIn,
    now: () => NOW,
    fetchMessage: async () => null,
  });
  return {
    ...device,
    host,
    writes,
    requests,
    sent: () => requests.map(({ id }) => id),
    signInAgain() {
      signIn += 1;
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const lifetime of lifetimes.splice(0)) lifetime.abort();
});

const settle = () => vi.advanceTimersByTimeAsync(1);

const root = graphqlMessage(1);
const other = graphqlMessage(8);

describe.each([
  ['the queue refuses', () => new Error('the queue refused it')],
  [
    'no engine admitted',
    () =>
      Object.assign(new Error('no owner took the write'), {
        errorCode: 'write-not-admitted',
      }),
  ],
])('a write %s', (_name, failure) => {
  const refusing = () => Promise.reject(failure());

  it('goes nowhere, and lets the writes after it go', async () => {
    vi.useFakeTimers();
    const fixture = setup(
      vi
        .fn<CacheHost['enqueueOptimisticMutation']>(claimed)
        .mockImplementationOnce(refusing)
    );
    const refusedSend = outcome(fixture.writes.send(send(root.id)));
    const sending = fixture.writes.send(send(other.id));
    await settle();
    // Straight out it would pass the writes the queue keeps.
    expect(fixture.sent()).toEqual([other.id]);
    // Known not to have left: its draft can go again under any id.
    expect(await refusedSend).toBe('NOT_QUEUED');
    expect(fixture.writes.pendingCount(CHANNEL_ID)).toBe(1);
    fixture.requests[0].answer(json(written('sendChannelMessage', other)));
    await settle();
    expect((await sending)?.id).toBe(other.id);
  });

  it('is handed over again when the database was away', async () => {
    vi.useFakeTimers();
    const refused = Promise.withResolvers<never>();
    const fixture = setup(
      vi
        .fn<CacheHost['enqueueOptimisticMutation']>(claimed)
        .mockImplementationOnce(() => refused.promise)
    );
    const sending = fixture.writes.send(send(root.id));
    await settle();
    fixture.availability.paused = true;
    refused.reject(failure());
    await settle();
    expect(fixture.sent()).toEqual([]);
    expect(fixture.writes.pendingCount(CHANNEL_ID)).toBe(1);

    fixture.availability.paused = false;
    fixture.writes.resumed();
    await settle();
    expect(fixture.sent()).toEqual([root.id]);
    fixture.requests[0].answer(json(written('sendChannelMessage', root)));
    await settle();
    expect((await sending)?.id).toBe(root.id);
  });

  it('does not go out under a later sign-in', async () => {
    vi.useFakeTimers();
    const refused = Promise.withResolvers<never>();
    const fixture = setup(() => refused.promise);
    const sending = outcome(fixture.writes.send(send(root.id)));
    await settle();
    fixture.signInAgain();
    refused.reject(failure());
    await settle();
    expect(await sending).toBe('CACHE_RETIRED');
    expect(fixture.sent()).toEqual([]);
  });
});

describe('a write asked for while no engine is there', () => {
  const noEngine = () =>
    Promise.reject(
      Object.assign(new Error('owner epoch 1 was lost'), {
        errorCode: 'owner-epoch-lost',
      })
    );
  /** A queue no engine serves until told so. */
  function betweenEngines() {
    const enqueue = vi
      .fn<CacheHost['enqueueOptimisticMutation']>()
      .mockImplementation(noEngine);
    return { enqueue, fixture: setup(enqueue) };
  }

  it('waits for the next one, in its turn', async () => {
    vi.useFakeTimers();
    const { enqueue, fixture } = betweenEngines();
    const first = fixture.writes.send(send(root.id));
    const second = outcome(fixture.writes.send(send(other.id)));
    await settle();
    expect(fixture.sent()).toEqual([]);
    expect(
      fixture.writes.unstoredRoots(CHANNEL_ID).map((row) => row.key)
    ).toEqual([channelMessageKey(other.id), channelMessageKey(root.id)]);

    enqueue.mockClear();
    enqueue.mockImplementation(claimed);
    fixture.restore();
    await settle();
    expect(enqueue.mock.calls.map(([{ uuid }]) => uuid)).toEqual([
      root.id,
      other.id,
    ]);
    expect(fixture.sent()).toEqual([root.id]);
    fixture.requests[0].answer(json(written('sendChannelMessage', root)));
    await settle();
    expect((await first)?.id).toBe(root.id);
    fixture.writes.retire();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await second).toBe('DELIVERY_UNKNOWN');
  });

  it('does not need to hear that the next one came', async () => {
    vi.useFakeTimers();
    const { enqueue, fixture } = betweenEngines();
    const sending = fixture.writes.send(send(root.id));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fixture.sent()).toEqual([]);
    // Asked again and again, at a bounded rate.
    expect(enqueue.mock.calls.length).toBeGreaterThan(3);
    expect(enqueue.mock.calls.length).toBeLessThan(20);

    enqueue.mockImplementation(claimed);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fixture.sent()).toEqual([root.id]);
    fixture.requests[0].answer(json(written('sendChannelMessage', root)));
    await settle();
    expect((await sending)?.id).toBe(root.id);
  });

  it('waits on when the database turns out to be away', async () => {
    vi.useFakeTimers();
    const { enqueue, fixture } = betweenEngines();
    const sending = fixture.writes.send(send(root.id));
    await settle();
    fixture.availability.paused = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const asked = enqueue.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(enqueue.mock.calls.length).toBe(asked);

    enqueue.mockImplementation(claimed);
    fixture.availability.paused = false;
    fixture.writes.resumed();
    await settle();
    expect(fixture.sent()).toEqual([root.id]);
    fixture.requests[0].answer(json(written('sendChannelMessage', root)));
    await settle();
    expect((await sending)?.id).toBe(root.id);
  });

  it('goes nowhere once its host or its sign-in ended', async () => {
    vi.useFakeTimers();
    const retired = betweenEngines();
    const unsent = outcome(retired.fixture.writes.send(send(root.id)));
    await settle();
    retired.fixture.writes.retire();
    await settle();
    expect(await unsent).toBe('CACHE_RETIRED');

    const signedOut = betweenEngines();
    const refused = outcome(signedOut.fixture.writes.send(send(root.id)));
    await settle();
    signedOut.fixture.signInAgain();
    signedOut.enqueue.mockImplementation(claimed);
    signedOut.fixture.restore();
    await settle();
    expect(await refused).toBe('CACHE_RETIRED');
    expect(signedOut.fixture.sent()).toEqual([]);
  });
});

it('does not hold a write behind one of an earlier sign-in', async () => {
  vi.useFakeTimers();
  const enqueue = vi
    .fn<CacheHost['enqueueOptimisticMutation']>(claimed)
    // A queue that never answers the first.
    .mockImplementationOnce(() => new Promise(() => {}));
  const fixture = setup(enqueue);
  const stalled = outcome(fixture.writes.send(send(root.id)));
  await settle();
  fixture.signInAgain();
  const sending = fixture.writes.send(send(root.id));
  await settle();
  expect(fixture.sent()).toEqual([root.id]);
  fixture.requests[0].answer(json(written('sendChannelMessage', root)));
  await settle();
  expect((await sending)?.id).toBe(root.id);
  fixture.writes.retire();
  expect(await stalled).toBe('DELIVERY_UNKNOWN');
});

describe('a write the queue took', () => {
  it('keeps what the server answered when the commit never did', async () => {
    vi.useFakeTimers();
    const fixture = setup(claimed, [root]);
    vi.spyOn(fixture.host, 'commitOptimisticWrite').mockRejectedValue(
      new Error('the worker went away')
    );
    const editing = outcome(fixture.writes.edit(edit(root)));
    await settle();
    fixture.requests[0].answer(
      json(written('editChannelMessage', { ...root, content: 'edited' }))
    );
    await settle();
    fixture.writes.retire();
    await settle();
    expect(await editing).toBe('delivered');
  });

  it('answers what the server did when the device could not store it', async () => {
    vi.useFakeTimers();
    const fixture = setup(claimed, [root]);
    vi.spyOn(fixture.host, 'commitOptimisticWrite').mockImplementation(
      async () => {
        const error = 'could not store the answer';
        fixture.settle({
          transactionId: TRANSACTION_ID,
          status: 'permanently-failed',
          error,
          errorCode: 'LOCAL_COMMIT_FAILED',
        });
        return { ...WRITE_RESULT, kind: 'failed', error };
      }
    );
    const editing = fixture.writes.edit(edit(root));
    await settle();
    fixture.requests[0].answer(
      json(written('editChannelMessage', { ...root, content: 'edited' }))
    );
    await settle();
    expect(await editing).toMatchObject({ id: root.id, content: 'edited' });
  });

  it('is delivered once it settled, though its host retired first', async () => {
    vi.useFakeTimers();
    const fixture = setup(claimed);
    vi.spyOn(fixture.host, 'commitOptimisticWrite').mockImplementation(() => {
      fixture.settle({
        transactionId: TRANSACTION_ID,
        mutationUuid: root.id,
        status: 'committed',
      });
      return new Promise(() => {});
    });
    const sending = fixture.writes.send(send(root.id));
    await settle();
    fixture.requests[0].answer(json(written('sendChannelMessage', root)));
    await settle();
    fixture.writes.retire();
    await settle();
    expect((await sending)?.id).toBe(root.id);
  });
});
