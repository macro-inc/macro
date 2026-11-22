import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ChannelDirectoryState,
  channelDirectoryState,
  type PrimaryChannelRead,
} from './directory';
import type { DirectoryChannel } from './directory-core';
import {
  createDepartureRecheck,
  DEPARTURES_LIMIT,
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
  })
) {
  const controller = new AbortController();
  let generation: string | undefined = 'g1';
  let current: ChannelDirectoryState = complete();
  const readFromPrimary = vi.fn((id: string, _signal?: AbortSignal) =>
    read(id)
  );
  const removeUnreadable = vi.fn(
    async (
      _ids: readonly string[],
      _generation: string,
      _signal: AbortSignal
    ) => undefined
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
        'channel_directory.departures_unreadable': 1,
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

  it('tries a failed read again at the next check, then stops', async () => {
    const h = setup(async () => ({ kind: 'failed' }));
    leave(h, 'deletion');
    comeBack(h);

    await vi.advanceTimersByTimeAsync(RECHECKS[1] * 4);
    expect(h.readIds()).toEqual(['gone', 'gone']);
    expect(h.removeUnreadable).not.toHaveBeenCalled();
    expect(
      spans.map(({ attrs }) => attrs['channel_directory.departures_failed'])
    ).toEqual([1, 1]);
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
