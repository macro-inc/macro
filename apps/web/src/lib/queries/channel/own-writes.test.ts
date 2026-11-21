import { QueryClient } from '@tanstack/solid-query';
import { createComputed, createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryChannel } from './directory-core';
import {
  createOwnWriteTracker,
  OWN_WRITE_HOLD_MS,
  type OwnChannelWrite,
  overlayOwnWrites,
  ownChannelWrites,
  sightWrite,
  sourceBehindWrite,
  UNSEEN,
  type WriteSighting,
} from './own-writes';
import { channelUuid } from './tests/channel-uuid';
import {
  directoryChannel,
  directoryParticipant,
} from './tests/directory-channel';

const VIEWER = 'macro|viewer@example.com';
const ACCOUNT = { userId: VIEWER, session: 1 };
const A = channelUuid('a');
const B = channelUuid('b');

const write = (
  channel: DirectoryChannel | null,
  { account = ACCOUNT, sequence = 1 } = {}
): OwnChannelWrite => ({ channel, account, sequence });

const written = directoryChannel(A, {
  name: 'after',
  updatedAt: '2026-11-02T00:00:00+00:00',
  participants: [
    directoryParticipant('macro|one@example.com'),
    directoryParticipant('macro|two@example.com'),
  ],
});

/** Whether `source` is behind `w` when it is the first record of the
 * channel the directory sees since the write, or after `seen`. */
const behind = (
  w: OwnChannelWrite,
  source: DirectoryChannel | undefined,
  seen: WriteSighting = UNSEEN
) => sourceBehindWrite(w, source, sightWrite(w, seen, source));

describe('sourceBehindWrite', () => {
  it('is caught up when only the viewer’s own view, interaction or frecency moved', () => {
    expect(
      behind(write(written), {
        ...written,
        viewedAt: '2026-11-03T00:00:00Z',
        interactedAt: '2026-11-03T00:00:00Z',
        frecencyScore: 4.5,
      })
    ).toBe(false);
  });

  it('compares people as sets and instants by value', () => {
    expect(
      behind(write(written), {
        ...written,
        updatedAt: '2026-11-02T00:00:00.000000Z',
        participants: [...written.participants].reverse(),
      })
    ).toBe(false);
  });

  it('is behind while it shows the channel otherwise, or has not shown it yet', () => {
    expect(
      behind(write(written), {
        ...written,
        name: 'before',
        updatedAt: '2026-11-01T00:00:00Z',
      })
    ).toBe(true);
    expect(
      behind(write(written), {
        ...written,
        participants: written.participants.slice(1),
      })
    ).toBe(true);
    expect(behind(write(written), undefined)).toBe(true);
  });

  it('is past the write once it shows a later update', () => {
    expect(
      behind(write(written), {
        ...written,
        name: 'theirs',
        updatedAt: '2026-11-02T00:00:00.000001Z',
      })
    ).toBe(false);
  });

  it('is past the write once a channel it showed since is gone: it was removed after', () => {
    const before = { ...written, name: 'before', updatedAt: '2026-11-01Z' };
    const seen = sightWrite(write(written), UNSEEN, before);
    expect(behind(write(written), before)).toBe(true);
    expect(behind(write(written), undefined, seen)).toBe(false);
  });

  it('is behind a channel the viewer can no longer read only while it lists them as it first did', () => {
    expect(behind(write(null), written)).toBe(true);
    expect(behind(write(null), { ...written, isParticipant: false })).toBe(
      false
    );
    expect(behind(write(null), undefined)).toBe(false);
  });

  it('is past a channel the viewer can no longer read once they joined it again', () => {
    const member = {
      ...written,
      participants: [
        ...written.participants,
        { ...directoryParticipant(VIEWER), joinedAt: '2026-11-01T00:00:00Z' },
      ],
    };
    const seen = sightWrite(write(null), UNSEEN, member);
    // Messages and renames move the update time, not the viewer's join.
    expect(
      behind(
        write(null),
        { ...member, name: 'renamed', updatedAt: '2026-11-03T00:00:00Z' },
        seen
      )
    ).toBe(true);
    const rejoined = {
      ...member,
      participants: [
        ...written.participants,
        { ...directoryParticipant(VIEWER), joinedAt: '2026-11-03T00:00:00Z' },
      ],
    };
    expect(behind(write(null), rejoined, seen)).toBe(false);
  });
});

describe('overlayOwnWrites', () => {
  const stale = directoryChannel(A, { name: 'before' });
  const other = directoryChannel(B);

  it('lays the writes over what was read, and settles their ids', () => {
    const overlaid = overlayOwnWrites(
      { [A]: stale, [B]: other },
      { [A]: true, [B]: true },
      [[A, write(written)]]
    );
    expect(overlaid.records).toEqual({ [A]: written, [B]: other });
    expect(overlaid.incompleteIds).toEqual([B]);
  });

  it('takes out a channel the viewer can no longer read', () => {
    expect(
      overlayOwnWrites({ [A]: stale, [B]: other }, {}, [[A, write(null)]])
        .records
    ).toEqual({ [B]: other });
  });
});

describe('createOwnWriteTracker', () => {
  const stale = { ...written, name: 'before', updatedAt: '2026-11-01Z' };

  it('ignores writes of another account, or of the viewer in another sign-in', () => {
    const own = ownChannelWrites(new QueryClient());
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    const writes = {
      [A]: write(written, {
        account: { userId: 'macro|other@example.com', session: 1 },
      }),
      [B]: write(null, { account: { userId: VIEWER, session: 2 } }),
    };
    expect(
      tracker.pending({ [A]: stale, [B]: directoryChannel(B) }, writes)
    ).toEqual([]);
  });

  it('lets a write go for good once its source showed it, so a later removal is not lag', async () => {
    const own = ownChannelWrites(new QueryClient());
    const w = write(written);
    own.record({ [A]: w });
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    expect(tracker.pending({ [A]: stale }, own.writes())).toEqual([[A, w]]);
    expect(tracker.pending({ [A]: written }, own.writes())).toEqual([]);
    // The record is gone (access revoked) before the release lands.
    expect(tracker.pending({}, { [A]: w })).toEqual([]);
    await Promise.resolve();
    expect(own.writes()).toEqual({});
  });

  it('remembers nothing from a one-time read', () => {
    const own = ownChannelWrites(new QueryClient());
    const w = write(written);
    own.record({ [A]: w });
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    expect(tracker.pendingFor({ [A]: stale }, own.writes())).toEqual([[A, w]]);
    // The directory's own source never showed the channel, so its absence
    // is still lag.
    expect(tracker.pending({}, own.writes())).toEqual([[A, w]]);
    expect(tracker.pendingFor({ [A]: written }, own.writes())).toEqual([]);
    expect(tracker.pending({}, own.writes())).toEqual([[A, w]]);
  });
});

describe('ownChannelWrites', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one store per query client', () => {
    const client = new QueryClient();
    expect(ownChannelWrites(client)).toBe(ownChannelWrites(client));
    expect(ownChannelWrites(new QueryClient())).not.toBe(
      ownChannelWrites(client)
    );
  });

  it('holds each write for its own full hold', () => {
    vi.useFakeTimers();
    const own = ownChannelWrites(new QueryClient());
    own.record({ [A]: write(written, { sequence: own.nextSequence() }) });
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    const later = write(
      { ...written, name: 'again' },
      { sequence: own.nextSequence() }
    );
    own.record({ [A]: later, [B]: write(null, { sequence: later.sequence }) });

    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()[A]).toBe(later);
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()).toEqual({});
  });

  it('never lets a read sent earlier replace one sent later, even after it went', () => {
    const own = ownChannelWrites(new QueryClient());
    const first = own.nextSequence();
    const second = own.nextSequence();
    const newer = write({ ...written, name: 'newer' }, { sequence: second });
    own.record({ [A]: newer });
    own.record({ [A]: write(written, { sequence: first }) });
    expect(own.writes()[A]).toBe(newer);
    own.release(A, newer);
    own.record({ [A]: write(written, { sequence: first }) });
    expect(own.writes()).toEqual({});
  });

  it('lets every write go on clear, and drops the reads still in flight', () => {
    const own = ownChannelWrites(new QueryClient());
    own.record({ [A]: write(written, { sequence: own.nextSequence() }) });
    const inFlight = own.nextSequence();
    own.clear();
    expect(own.writes()).toEqual({});
    own.record({ [B]: write(null, { sequence: inFlight }) });
    expect(own.writes()).toEqual({});
    own.record({ [B]: write(null, { sequence: own.nextSequence() }) });
    expect(Object.keys(own.writes())).toEqual([B]);
  });

  it('takes many writes in one change', () => {
    const own = ownChannelWrites(new QueryClient());
    let runs = 0;
    const dispose = createRoot((done) => {
      createComputed(() => {
        own.writes();
        runs += 1;
      });
      return done;
    });
    const sequence = own.nextSequence();
    own.record({
      [A]: write(written, { sequence }),
      [B]: write(null, { sequence }),
    });
    dispose();
    expect(runs).toBe(2);
  });
});
