import { thrownResultErrorHasCode } from '@core/util/result';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import { type Answer, send, setup, written } from './write-fixtures';

/** What a write failed with, or undefined when it did not fail. */
const failure = async (write: Promise<unknown>): Promise<unknown> => {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
};

const settleMicrotasks = () => new Promise((resolve) => setTimeout(resolve, 0));

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

const first = graphqlMessage(7);
const second = graphqlMessage(8);

const edit = (message: ChannelMessageFieldsFragment) => ({
  channelId: CHANNEL_ID,
  id: message.id,
  content: 'edited',
  mentions: [],
  removeAttachmentIds: [],
  addAttachments: [],
  nonce: 'e',
});

afterEach(() => vi.useRealTimers());

describe('a sign-in that replaces the session', () => {
  it('keeps a write waiting its turn from going out under it', async () => {
    let signIn = 1;
    const fixture = setup(answering([first, second]), [], [], () => signIn);
    const installing = Promise.withResolvers<void>();
    fixture.queue.installing = installing.promise;
    const sending = fixture.writes.send(send(first.id));
    const waiting = failure(fixture.writes.send(send(second.id)));
    await settleMicrotasks();
    expect(sentIds(fixture.calls)).toEqual([first.id]);

    signIn = 2;
    installing.resolve();
    expect((await sending).id).toBe(first.id);
    expect(thrownResultErrorHasCode(await waiting, 'CACHE_RETIRED')).toBe(true);
    expect(sentIds(fixture.calls)).toEqual([first.id]);
  });

  it('leaves the writes asked for after it alone', async () => {
    let signIn = 1;
    const fixture = setup(answering([first]), [], [], () => signIn);
    signIn = 2;
    expect((await fixture.writes.send(send(first.id))).id).toBe(first.id);
  });
});

describe('a host that retires', () => {
  it('ends the hand-off its queue has not acknowledged', async () => {
    const fixture = setup(answering([first, second]));
    const installing = Promise.withResolvers<void>();
    fixture.queue.installing = installing.promise;
    const handedOver = failure(fixture.writes.send(send(first.id)));
    const waiting = failure(fixture.writes.send(send(second.id)));
    await settleMicrotasks();
    expect(sentIds(fixture.calls)).toEqual([first.id]);

    fixture.writes.retire();
    // It may be in the queue; the other never left.
    expect(thrownResultErrorHasCode(await handedOver, 'DELIVERY_UNKNOWN')).toBe(
      true
    );
    expect(thrownResultErrorHasCode(await waiting, 'CACHE_RETIRED')).toBe(true);
    expect(fixture.writes.pendingCount(CHANNEL_ID)).toBe(0);
    installing.resolve();
  });

  it('fails an edit its queue has not acknowledged', async () => {
    const fixture = setup(
      () => ({ data: written('editChannelMessage', first) }),
      [first]
    );
    const installing = Promise.withResolvers<void>();
    fixture.queue.installing = installing.promise;
    const editing = failure(fixture.writes.edit(edit(first)));
    await settleMicrotasks();
    fixture.writes.retire();
    expect(thrownResultErrorHasCode(await editing, 'CACHE_RETIRED')).toBe(true);
    installing.resolve();
  });

  it('gives a write already sent straight out time to answer', async () => {
    vi.useFakeTimers();
    const answered = Promise.withResolvers<Answer>();
    const fixture = setup(() => answered.promise);
    const sending = fixture.writes.send(send(first.id));
    await vi.advanceTimersByTimeAsync(0);
    fixture.writes.retire();
    await vi.advanceTimersByTimeAsync(5_000);
    answered.resolve({ data: written('sendChannelMessage', first) });
    expect((await sending).id).toBe(first.id);
  });

  it('does not wait forever for the answer', async () => {
    vi.useFakeTimers();
    const fixture = setup(() => new Promise<Answer>(() => {}));
    const sending = failure(fixture.writes.send(send(first.id)));
    await vi.advanceTimersByTimeAsync(0);
    fixture.writes.retire();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(thrownResultErrorHasCode(await sending, 'DELIVERY_UNKNOWN')).toBe(
      true
    );
  });

  it('ends a send asking a queue that no longer answers', async () => {
    const fixture = setup(() => ({
      error: new CombinedError({
        networkError: Object.assign(new Error('reply lost'), {
          errorCode: 'admitted-enqueue-uncertain',
        }),
      }),
    }));
    const inspecting = vi
      .spyOn(fixture.host, 'inspectMutations')
      .mockImplementation(() => new Promise(() => {}));
    const sending = failure(fixture.writes.send(send(first.id)));
    await settleMicrotasks();
    expect(inspecting).toHaveBeenCalled();
    fixture.writes.retire();
    expect(thrownResultErrorHasCode(await sending, 'DELIVERY_UNKNOWN')).toBe(
      true
    );
  });
});

describe('a write the server took and the device could not store', () => {
  const uncommitted = (messageId: string) => ({
    mutationUuid: messageId,
    transactionId: '4',
    status: 'permanently-failed' as const,
    error: 'missing identity response id',
    errorCode: 'LOCAL_COMMIT_FAILED',
  });
  const queuedAnswer = (): Answer => ({
    disposition: { kind: 'queued', transactionId: '4' },
  });

  it('delivers a send the server has', async () => {
    const fixture = setup(queuedAnswer, [], [first]);
    const sending = fixture.writes.send(send(first.id));
    await settleMicrotasks();
    fixture.settle(uncommitted(first.id));
    expect((await sending).id).toBe(first.id);
    expect(fixture.fetched).toEqual([first.id]);
  });

  it('keeps a send it cannot find unknown', async () => {
    vi.useFakeTimers();
    const fixture = setup(queuedAnswer);
    const sending = failure(fixture.writes.send(send(first.id)));
    await vi.advanceTimersByTimeAsync(0);
    fixture.settle(uncommitted(first.id));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(thrownResultErrorHasCode(await sending, 'DELIVERY_UNKNOWN')).toBe(
      true
    );
  });

  it('does not fail an edit the server took', async () => {
    const fixture = setup(queuedAnswer, [first]);
    const editing = fixture.writes.edit(edit(first));
    await settleMicrotasks();
    fixture.settle(uncommitted(fixture.queue.lastUuid));
    expect((await editing).id).toBe(first.id);
  });
});
