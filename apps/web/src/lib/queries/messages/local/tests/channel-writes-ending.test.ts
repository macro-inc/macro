import { thrownResultErrorHasCode } from '@core/util/result';
import type { ChannelMessageFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import { createMemo, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { channelMessageKey } from '../channel-map';
import { CHANNEL_ID, graphqlMessage } from './fixtures';
import { type Answer, SENDER, send, setup, written } from './write-fixtures';

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
    const fixture = setup(answering([first, second]), [], [], {
      signIn: () => signIn,
    });
    const installing = Promise.withResolvers<void>();
    fixture.queue.installing = installing.promise;
    const sending = fixture.writes.send(send(first.id));
    const waiting = failure(fixture.writes.send(send(second.id)));
    await settleMicrotasks();
    expect(sentIds(fixture.calls)).toEqual([first.id]);

    signIn = 2;
    installing.resolve();
    expect((await sending)?.id).toBe(first.id);
    expect(thrownResultErrorHasCode(await waiting, 'CACHE_RETIRED')).toBe(true);
    expect(sentIds(fixture.calls)).toEqual([first.id]);
  });

  it('shows none of what the one before it was sending', async () => {
    const [signIn, setSignIn] = createSignal(1);
    const fixture = setup(() => new Promise<Answer>(() => {}), [], [], {
      signIn,
    });
    const { writes } = fixture;
    const reply = send(second.id, { content: 'hi', thread_id: first.id });
    const ended = [writes.send(send(first.id)), writes.send(reply)].map(
      failure
    );
    const shown = () => ({
      count: writes.pendingCount(CHANNEL_ID),
      roots: writes.unstoredRoots(CHANNEL_ID).map(({ key }) => key),
      replies: writes.unstoredReplies(CHANNEL_ID, first.id).map(({ id }) => id),
    });
    await createRoot(async (dispose) => {
      const seen = createMemo(shown);
      const mine = {
        count: 2,
        roots: [channelMessageKey(first.id)],
        replies: [second.id],
      };
      expect(seen()).toEqual(mine);
      setSignIn(2);
      expect(seen()).toEqual({ count: 0, roots: [], replies: [] });
      // Asked for again under the new one, with the id it had.
      const again = failure(writes.send(send(first.id)));
      expect(seen()).toEqual({
        count: 1,
        roots: [channelMessageKey(first.id)],
        replies: [],
      });
      fixture.writes.retire();
      await Promise.all([...ended, again]);
      dispose();
    });
  });

  it('keeps showing its own send of an id the one before it was sending', async () => {
    let signIn = 1;
    const answers = [
      Promise.withResolvers<Answer>(),
      Promise.withResolvers<Answer>(),
    ];
    const { writes } = setup(
      () => {
        const answer = answers[signIn - 1];
        return answer ? answer.promise : {};
      },
      [],
      [],
      { signIn: () => signIn }
    );
    const before = writes.send(send(first.id));
    await settleMicrotasks();
    signIn = 2;
    const own = writes.send(send(first.id));
    await settleMicrotasks();

    answers[0]?.resolve({ data: written('sendChannelMessage', first) });
    await before;
    expect(writes.pendingCount(CHANNEL_ID)).toBe(1);

    answers[1]?.resolve({ data: written('sendChannelMessage', first) });
    await own;
    expect(writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('sends nothing of a user it is not', async () => {
    const fixture = setup(answering([first, second]), [], [], {
      mayWrite: (userId) => userId !== SENDER,
    });
    const sending = failure(fixture.writes.send(send(first.id)));
    expect(thrownResultErrorHasCode(await sending, 'CACHE_RETIRED')).toBe(true);
    const reacting = failure(
      fixture.writes.react({
        channelId: CHANNEL_ID,
        id: second.id,
        emoji: 'up',
        add: true,
        userId: SENDER,
        nonce: 'r',
      })
    );
    expect(thrownResultErrorHasCode(await reacting, 'CACHE_RETIRED')).toBe(
      true
    );
    expect(fixture.calls).toEqual([]);
    expect(fixture.writes.pendingCount(CHANNEL_ID)).toBe(0);
  });

  it('sends nothing before it says who it is', async () => {
    let named = false;
    const fixture = setup(answering([first]), [first], [], {
      mayWrite: () => named,
    });
    const editing = failure(fixture.writes.edit(edit(first)));
    expect(thrownResultErrorHasCode(await editing, 'CACHE_RETIRED')).toBe(true);
    expect(fixture.calls).toEqual([]);

    named = true;
    expect((await fixture.writes.send(send(first.id)))?.id).toBe(first.id);
  });

  it('leaves the writes asked for after it alone', async () => {
    let signIn = 1;
    const fixture = setup(answering([first]), [], [], {
      signIn: () => signIn,
    });
    signIn = 2;
    expect((await fixture.writes.send(send(first.id)))?.id).toBe(first.id);
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

  it('gives a write its queue acknowledged time to answer', async () => {
    vi.useFakeTimers();
    const answered = Promise.withResolvers<Answer>();
    const fixture = setup(() => answered.promise);
    const sending = fixture.writes.send(send(first.id));
    await vi.advanceTimersByTimeAsync(0);
    fixture.writes.retire();
    await vi.advanceTimersByTimeAsync(5_000);
    answered.resolve({ data: written('sendChannelMessage', first) });
    expect((await sending)?.id).toBe(first.id);
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
    expect((await sending)?.id).toBe(first.id);
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

  it('answers an edit with the server’s copy, not the device’s', async () => {
    const taken = { ...first, content: 'edited' };
    const fixture = setup(queuedAnswer, [first], [taken]);
    const editing = fixture.writes.edit(edit(first));
    await settleMicrotasks();
    fixture.settle(uncommitted(fixture.queue.lastUuid));
    expect((await editing)?.content).toBe('edited');
  });

  it('answers an edit whose copy it cannot read with none', async () => {
    // The device still shows the message from before.
    const fixture = setup(queuedAnswer, [first]);
    const editing = fixture.writes.edit(edit(first));
    await settleMicrotasks();
    fixture.settle(uncommitted(fixture.queue.lastUuid));
    expect(await editing).toBeUndefined();
  });

  it('answers an edit the queue confirmed with none when the device cannot be read', async () => {
    const fixture = setup(queuedAnswer, [first]);
    const editing = fixture.writes.edit(edit(first));
    await settleMicrotasks();
    vi.spyOn(fixture.host, 'readRecordsByKeys').mockRejectedValue(
      new Error('device unreadable')
    );
    fixture.settle({
      mutationUuid: fixture.queue.lastUuid,
      transactionId: '4',
      status: 'committed',
    });
    expect(await editing).toBeUndefined();
  });
});
