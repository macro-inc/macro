import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelDirectoryState,
  channelDirectoryState,
  type PrimaryChannelRead,
} from './directory';
import type { DirectoryChannel } from './directory-core';
import {
  createDepartureRecheck,
  DEPARTURE_RETRY_MS,
  DEPARTURE_ROUND_DEADLINE_MS,
  DEPARTURES_LIMIT,
  type RemoveUnreadableResult,
} from './directory-departures';
import { channelName, channelUuid } from './tests/channel-uuid';
import { directoryChannel } from './tests/directory-channel';

const spans = vi.hoisted(
  () => [] as { name: string; attrs: Record<string, unknown> }[]
);
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Telemetry: {
    error: vi.fn(),
    span: async (
      name: string,
      operation: (span: {
        setAttr: (key: string, value: unknown) => void;
        run: <T>(work: () => T) => T;
      }) => Promise<unknown>
    ) => {
      const attrs: Record<string, unknown> = {};
      spans.push({ name, attrs });
      return operation({
        setAttr: (key, value) => {
          attrs[key] = value;
        },
        run: (work) => work(),
      });
    },
  },
}));

const RECHECKS = [1_000, 5_000];

const channel = (name: string, overrides: Partial<DirectoryChannel> = {}) =>
  directoryChannel(channelUuid(name), overrides);

const complete = (...channels: DirectoryChannel[]) =>
  channelDirectoryState(channels, [], true);

type Harness = ReturnType<typeof setup>;

function setup(
  read: (id: string) => Promise<PrimaryChannelRead> = async () => ({
    kind: 'read',
    channel: null,
  }),
  remove: (
    ids: readonly string[]
  ) => Promise<RemoveUnreadableResult | undefined> = async () => undefined
) {
  const controller = new AbortController();
  let generation: string | undefined = 'g1';
  let current: ChannelDirectoryState = complete();
  const readFromPrimary = vi.fn((id: string, _signal?: AbortSignal) =>
    read(id)
  );
  const removeUnreadable = vi.fn(
    async (ids: readonly string[], _generation: string, _signal: AbortSignal) =>
      remove(ids)
  );
  const recheck = createDepartureRecheck({
    generation: () => generation,
    current: () => current,
    readFromPrimary,
    removeUnreadable,
    signal: controller.signal,
    rechecksMs: RECHECKS,
  });
  /** Shows `next`, as the directory publishes it. */
  const show = (
    next: ChannelDirectoryState,
    unconfirmed: Readonly<Record<string, true>> = {}
  ) => {
    recheck.observe(current, next, unconfirmed);
    current = next;
  };
  return {
    recheck,
    readFromPrimary,
    removeUnreadable,
    show,
    controller,
    setGeneration(next: string | undefined) {
      generation = next;
    },
    readIds: () => readFromPrimary.mock.calls.map(([id]) => channelName(id)),
  };
}

/** Shows `kept` and `gone` joined, then the viewer leaving `gone` by `how`. */
function leave(h: Harness, how: 'deletion' | 'record') {
  h.show(complete(channel('kept'), channel('gone')));
  h.show(
    how === 'deletion'
      ? complete(channel('kept'))
      : complete(channel('kept'), channel('gone', { isParticipant: false }))
  );
}

/** Lands an older read that shows `gone` joined again. */
const comeBack = (h: Harness) =>
  h.show(complete(channel('kept'), channel('gone')));

describe('checking a channel the viewer left again', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spans.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['deletion', 'record'] as const)(
    'deletes a left channel (by %s) that came back joined once the primary shows it unreadable',
    async (how) => {
      const h = setup();
      leave(h, how);
      comeBack(h);
      // Nothing is hidden, and nothing is read before the first check.
      expect(h.readFromPrimary).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(RECHECKS[0]);
      expect(h.readIds()).toEqual(['gone']);
      expect(h.removeUnreadable).toHaveBeenCalledWith(
        [channelUuid('gone')],
        'g1',
        expect.any(AbortSignal)
      );
      expect(spans.map(({ name }) => name)).toEqual([
        'channel_directory.departure_recheck',
      ]);
      expect(spans[0]?.attrs).toMatchObject({
        'channel_directory.departures_due': 1,
        'channel_directory.departures_started': 1,
        'channel_directory.departures_outcome': 'complete',
        'channel_directory.departures_unreadable': 1,
        'channel_directory.departures_unconfirmed': 0,
      });
    }
  );

  it('reads nothing while the cache keeps the channel out', async () => {
    const h = setup();
    leave(h, 'deletion');

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
    expect(spans).toEqual([]);
  });

  it('reads it at the second check when it comes back after the first', async () => {
    const h = setup();
    leave(h, 'deletion');
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    comeBack(h);
    expect(h.readFromPrimary).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RECHECKS[1] - RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone']);
  });

  it('forgets the channel once the primary shows the viewer back in', async () => {
    const h = setup(async (id) => ({
      kind: 'read',
      channel: directoryChannel(id),
    }));
    leave(h, 'deletion');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readIds()).toEqual(['gone']);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
  });

  it('reads it again at the next check while the cache still shows it joined after the primary showed them out', async () => {
    const h = setup(async (id) => ({
      kind: 'read',
      channel: directoryChannel(id, { isParticipant: false }),
    }));
    leave(h, 'record');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone']);
    await vi.advanceTimersByTimeAsync(RECHECKS[1] - RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone', 'gone']);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
    // No check is left after the last.
    await vi.advanceTimersByTimeAsync(RECHECKS[1] * 4);
    expect(h.readIds()).toEqual(['gone', 'gone']);
  });

  it('tries a failed read again at the next check and once after the last, then stops', async () => {
    const h = setup(async () => ({ kind: 'failed' }));
    leave(h, 'deletion');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1]);
    expect(h.readIds()).toEqual(['gone', 'gone']);
    await vi.advanceTimersByTimeAsync(DEPARTURE_RETRY_MS);
    expect(h.readIds()).toEqual(['gone', 'gone', 'gone']);
    await vi.advanceTimersByTimeAsync(DEPARTURE_RETRY_MS * 4);
    expect(h.readIds()).toEqual(['gone', 'gone', 'gone']);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
    expect(
      spans.map(({ attrs }) => attrs['channel_directory.departures_failed'])
    ).toEqual([1, 1, 1]);
  });

  it('follows a live leave of a channel the directory never listed', async () => {
    const h = setup();
    h.show(complete(channel('kept')));
    h.recheck.depart(channelUuid('gone'));
    // A read sent before the leave lands it joined.
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone']);
    expect(h.removeUnreadable).toHaveBeenCalledTimes(1);
  });

  it('ignores live updates before it has seen a state of this storage', async () => {
    const h = setup();
    h.recheck.depart(channelUuid('gone'));
    h.show(complete(channel('kept')));
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
  });

  it('drops a departure the viewer took back live', async () => {
    const h = setup();
    leave(h, 'deletion');
    h.recheck.rejoin(channelUuid('gone'));
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
  });

  it('reads once more when the viewer rejoined live while a read that shows them out was out', async () => {
    const answers: ((read: PrimaryChannelRead) => void)[] = [];
    const h = setup(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
        })
    );
    leave(h, 'deletion');
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(answers).toHaveLength(1);

    h.recheck.rejoin(channelUuid('gone'));
    answers[0]?.({ kind: 'read', channel: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(answers).toHaveLength(2);
    answers[1]?.({
      kind: 'read',
      channel: directoryChannel(channelUuid('gone')),
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
    expect(spans[0]?.attrs['channel_directory.departures_joined']).toBe(1);
  });

  it('keeps a newer leave when an older check finds the viewer joined', async () => {
    const answers: ((read: PrimaryChannelRead) => void)[] = [];
    const h = setup(
      () =>
        new Promise((resolve) => {
          answers.push(resolve);
          // Every check after the first finds the channel unreadable.
          if (answers.length > 1) resolve({ kind: 'read', channel: null });
        })
    );
    leave(h, 'deletion');
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(answers).toHaveLength(1);

    // The viewer leaves again while the first check is out.
    h.recheck.depart(channelUuid('gone'));
    answers[0]?.({
      kind: 'read',
      channel: directoryChannel(channelUuid('gone')),
    });
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone', 'gone']);
    expect(h.removeUnreadable).toHaveBeenCalledTimes(1);
  });

  it('reads a channel deleted without a confirming read again, though the cache no longer shows it', async () => {
    let removes = 0;
    const h = setup(undefined, async (ids) => {
      removes += 1;
      return { unconfirmed: removes === 1 ? ids : [] };
    });
    leave(h, 'deletion');
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.removeUnreadable).toHaveBeenCalledTimes(1);
    // The delete took it out of the cache.
    h.show(complete(channel('kept')));

    await vi.advanceTimersByTimeAsync(RECHECKS[1] - RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone', 'gone']);
    expect(h.removeUnreadable).toHaveBeenCalledTimes(2);
    expect(spans[0]?.attrs).toMatchObject({
      'channel_directory.departures_unconfirmed': 1,
      'channel_directory.departures_failed': 1,
    });
    await vi.advanceTimersByTimeAsync(DEPARTURE_RETRY_MS * 4);
    expect(h.readIds()).toEqual(['gone', 'gone']);
  });

  it('keeps reading a channel it could not delete, at a later retry', async () => {
    let removes = 0;
    const h = setup(undefined, async () => {
      removes += 1;
      if (removes === 1) throw new Error('storage busy');
      return { unconfirmed: [] };
    });
    leave(h, 'deletion');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1]);
    expect(h.removeUnreadable).toHaveBeenCalledTimes(2);
    expect(spans[0]?.attrs['channel_directory.departures_failed']).toBe(1);
  });

  it('deletes nothing once the directory goes while a read is out', async () => {
    let answer!: (read: PrimaryChannelRead) => void;
    const h = setup(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    leave(h, 'deletion');
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readFromPrimary).toHaveBeenCalledTimes(1);

    h.controller.abort();
    answer({ kind: 'read', channel: null });
    await vi.advanceTimersByTimeAsync(RECHECKS[1]);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
  });

  it('starts no batch past the round deadline, and leaves the rest due for the next round', async () => {
    // Each batch of four takes this long, under the per-check deadline:
    // batches start at 0, 15, 30 and 45 s, and none at 60 s.
    const READ_MS = 15_000;
    const h = setup(
      (id) =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ kind: 'read', channel: directoryChannel(id) }),
            READ_MS
          );
        })
    );
    const all = Array.from({ length: 20 }, (_, index) => channel(`c${index}`));
    h.show(complete(...all));
    h.show(complete());
    h.show(complete(...all));

    await vi.advanceTimersByTimeAsync(
      RECHECKS[0] + DEPARTURE_ROUND_DEADLINE_MS + 1_000
    );
    expect(spans[0]?.attrs).toMatchObject({
      'channel_directory.departures_due': 20,
      'channel_directory.departures_started': 16,
      'channel_directory.departures_outcome': 'deferred',
      'channel_directory.departures_joined': 16,
    });
    // The next round reads the four it did not start.
    await vi.advanceTimersByTimeAsync(READ_MS + 1_000);
    expect(spans[1]?.attrs).toMatchObject({
      'channel_directory.departures_due': 4,
      'channel_directory.departures_outcome': 'complete',
    });
    expect(new Set(h.readIds()).size).toBe(20);
    expect(h.readFromPrimary).toHaveBeenCalledTimes(20);
  });

  it('takes a thrown read for a failed one', async () => {
    const h = setup(async () => {
      throw new Error('offline');
    });
    leave(h, 'deletion');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone']);
    expect(spans[0]?.attrs['channel_directory.departures_failed']).toBe(1);
  });

  it('decides a joined channel that went missing while the directory was incomplete once it is complete', async () => {
    const h = setup();
    h.show(complete(channel('kept'), channel('gone')));
    // Missing from an incomplete read: not yet a departure.
    h.show(channelDirectoryState([channel('kept')], [], false));
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();

    h.show(channelDirectoryState([channel('kept')], [], false));
    h.show(complete(channel('kept')));
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readIds()).toEqual(['gone']);
  });

  it('takes no unconfirmed or incomplete channel for a departure', async () => {
    const h = setup();
    h.show(complete(channel('kept'), channel('a'), channel('b')));
    h.show(channelDirectoryState([channel('kept')], [channelUuid('a')], true), {
      [channelUuid('b')]: true,
    });
    h.show(complete(channel('kept'), channel('a'), channel('b')));

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
  });

  it('forgets every departure on reset and on another storage generation', async () => {
    const h = setup();
    leave(h, 'deletion');
    h.recheck.reset();
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();

    leave(h, 'deletion');
    h.setGeneration('g2');
    // The first state of the new storage starts over.
    comeBack(h);
    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
  });

  it('stops when the directory goes', async () => {
    const h = setup();
    leave(h, 'deletion');
    comeBack(h);
    h.controller.abort();

    await vi.advanceTimersByTimeAsync(RECHECKS[1] + 1_000);
    expect(h.readFromPrimary).not.toHaveBeenCalled();
  });

  it(`follows at most ${DEPARTURES_LIMIT} departures, reading four at a time`, async () => {
    let inFlight = 0;
    let most = 0;
    const h = setup(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { kind: 'read', channel: null };
    });
    const names = Array.from(
      { length: DEPARTURES_LIMIT + 10 },
      (_, index) => `c${index}`
    );
    const all = names.map((name) => channel(name));
    h.show(complete(...all));
    h.show(complete());
    h.show(complete(...all));

    await vi.advanceTimersByTimeAsync(RECHECKS[0]);
    expect(h.readFromPrimary).toHaveBeenCalledTimes(DEPARTURES_LIMIT);
    expect(most).toBe(4);
  });
});
