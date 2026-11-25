import { thrownResultErrorHasCode } from '@core/util/result';
import { normalizedCacheExchange } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createNoopCacheHost } from '@graphql-cache/host/noop-host';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { createClient, fetchExchange } from '@urql/core';
import { expect, it, vi } from 'vitest';
import { channelMessageKey } from '../channel-map';
import { createChannelWrites } from '../channel-writes';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import { type Answer, send, setup, written } from './write-fixtures';

const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What a write failed with, or undefined when it did not fail. */
const failure = async (write: Promise<unknown>): Promise<unknown> => {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
};

/** Answers each send with its row. */
const answering =
  (rows: ChannelMessageFieldsFragment[]) =>
  (variables: unknown): Answer => {
    const { id } = (variables as { input: { id: string } }).input;
    const row = rows.find((message) => message.id === id);
    return { data: row && written('sendChannelMessage', row) };
  };

const sentIds = (calls: ReturnType<typeof setup>['calls']) =>
  calls.map(({ variables }) => variables.input.id);

const root = graphqlMessage(1);
const reply = graphqlMessage(7, { threadId: root.id });
const later = graphqlMessage(8);
const replyTo = (message: ChannelMessageFieldsFragment) =>
  send(message.id, { content: 'reply', thread_id: root.id });

/** A device that does not answer a read of the root until told to. */
function slowRootRead(fixture: ReturnType<typeof setup>) {
  const read = fixture.host.readRecordsByKeys;
  const answered = Promise.withResolvers<void>();
  vi.spyOn(fixture.host, 'readRecordsByKeys').mockImplementationOnce(
    async (args) => {
      await answered.promise;
      return read(args);
    }
  );
  return answered.resolve;
}

it('does not let a new write pass the ones an outage held', async () => {
  const rows = [graphqlMessage(7), graphqlMessage(8)];
  const { writes, calls, startOutage, endOutage } = setup(answering(rows));
  startOutage();
  const earlier = writes.send(send(rows[0].id));
  await settleMicrotasks();
  endOutage();
  // Asked for before the write that waited has been handed over.
  const second = writes.send(send(rows[1].id));
  await Promise.all([earlier, second]);
  expect(sentIds(calls)).toEqual(rows.map(({ id }) => id));
});

it('keeps a reply ahead of a later send while its root is read', async () => {
  const fixture = setup(answering([reply, later]), [root]);
  const rootRead = slowRootRead(fixture);
  const replying = fixture.writes.send(replyTo(reply));
  const sending = fixture.writes.send(send(later.id));
  await settleMicrotasks();
  expect(fixture.writes.pendingCount(CHANNEL_ID)).toBe(2);
  expect(fixture.calls).toEqual([]);

  rootRead();
  await Promise.all([replying, sending]);
  expect(sentIds(fixture.calls)).toEqual([reply.id, later.id]);
});

it('counts a reply the queue has yet to store under its root', async () => {
  const replies = [reply, graphqlMessage(8, { threadId: root.id })];
  const fixture = setup(answering(replies), [root]);
  const installed = Promise.withResolvers<void>();
  fixture.queue.installing = installed.promise;
  const first = fixture.writes.send(replyTo(replies[0]));
  const second = fixture.writes.send(replyTo(replies[1]));
  await settleMicrotasks();
  expect(sentIds(fixture.calls)).toEqual([replies[0].id]);

  // The queue stores the reply with the root that counts it.
  const predicted = (index: number) =>
    (
      fixture.calls[index].context.optimisticResponse as {
        sendChannelMessage: { root: ChannelMessageFieldsFragment };
      }
    ).sendChannelMessage.root;
  fixture.device.records.set(channelMessageKey(root.id), predicted(0));
  installed.resolve();
  await Promise.all([first, second]);
  expect([predicted(0), predicted(1)].map((r) => r.thread?.replyCount)).toEqual(
    [1, 2]
  );
});

it('does not hand a reply over once its host retired', async () => {
  const fixture = setup(answering([reply]), [root]);
  const rootRead = slowRootRead(fixture);
  const replying = failure(fixture.writes.send(replyTo(reply)));
  await settleMicrotasks();
  // `client` answers the session's current client: another account's, perhaps.
  fixture.writes.retire();
  rootRead();
  expect(thrownResultErrorHasCode(await replying, 'CACHE_RETIRED')).toBe(true);
  expect(fixture.calls).toEqual([]);
});

it('does not hand a write over as the database goes away', async () => {
  const row = graphqlMessage(7);
  const { writes, calls, startOutage, endOutage } = setup(answering([row]));
  const sending = writes.send(send(row.id));
  startOutage();
  await settleMicrotasks();
  expect(calls).toEqual([]);

  endOutage();
  await sending;
  expect(sentIds(calls)).toEqual([row.id]);
});

it('keeps a write for the queue until the queue has been read', async () => {
  const row = graphqlMessage(7);
  const { writes, calls, availability, startOutage, endOutage } = setup(
    answering([row])
  );
  startOutage();
  // The database answers, but nothing has waited in this outage yet.
  availability.paused = false;
  const sending = writes.send(send(row.id));
  await settleMicrotasks();
  expect(calls).toEqual([]);

  endOutage();
  await sending;
  expect(sentIds(calls)).toEqual([row.id]);
});

it('keeps a write the database went away under on its way to the queue', async () => {
  const row = graphqlMessage(7);
  const lifetime = new AbortController();
  let paused = false;
  const enqueue = vi.fn(async () => {
    throw new Error('the queue refused it');
  });
  const host = {
    ...createNoopCacheHost(),
    get paused() {
      return paused;
    },
    get disabled() {
      return paused;
    },
    enqueueOptimisticMutation: enqueue,
  };
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: written('sendChannelMessage', row) }),
        { headers: { 'content-type': 'application/json' } }
      )
  );
  const client = createClient({
    url: 'https://example.test/graphql',
    exchanges: [
      normalizedCacheExchange(host, { signal: lifetime.signal }),
      fetchExchange,
    ],
    preferGetMethod: false,
    fetch: transport,
  });
  // The outage starts once the write is on its way.
  const writes = createChannelWrites({
    host,
    runtime: { notifyChanged: () => undefined },
    client: () => {
      paused = true;
      return client;
    },
  });
  try {
    const sending = writes.send(send(row.id));
    await settleMicrotasks();
    await settleMicrotasks();
    expect(transport).not.toHaveBeenCalled();
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

    writes.retire();
    const error = await failure(sending);
    expect(thrownResultErrorHasCode(error, 'CACHE_RETIRED')).toBe(true);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    lifetime.abort();
  }
});
