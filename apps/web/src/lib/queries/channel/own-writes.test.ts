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

/** `channel` with the viewer in it since `joinedAt`, or out of it. */
const withViewer = (channel: DirectoryChannel, joinedAt?: string) =>
  joinedAt
    ? {
        ...channel,
        isParticipant: true,
        participants: [
          ...channel.participants,
          directoryParticipant(VIEWER, { joinedAt }),
        ],
      }
    : { ...channel, isParticipant: false };

/** Whether `source` is behind `w` when it is the first record of the
 * channel the directory sees since the read, or after `seen`. */
const behind = (
  w: OwnChannelWrite,
  source: DirectoryChannel | undefined,
  seen: WriteSighting = UNSEEN
) => sourceBehindWrite(w, source, sightWrite(w, seen, source));

/** What the directory saw of the channel, record after record. */
const seenOf = (...shown: (DirectoryChannel | undefined)[]) =>
  shown.reduce<WriteSighting>(
    (sighting, source) => sightWrite(write(null), sighting, source),
    UNSEEN
  );

/** Sends a read of `channels` and settles it with what it found. */
const settle = (
  own: ReturnType<typeof ownChannelWrites>,
  found: Record<string, DirectoryChannel | null>,
  account = ACCOUNT
) => own.send(account, Object.keys(found)).settle(found);

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
    const member = withViewer(written, '2026-11-01T00:00:00Z');
    const seen = sightWrite(write(null), UNSEEN, member);
    // Messages and renames move the update time, not the viewer's join.
    expect(
      behind(
        write(null),
        { ...member, name: 'renamed', updatedAt: '2026-11-03T00:00:00Z' },
        seen
      )
    ).toBe(true);
    const rejoined = withViewer(written, '2026-11-03T00:00:00Z');
    expect(behind(write(null), rejoined, seen)).toBe(false);
  });

  it('is behind a write that has the viewer in while it shows them out, until it showed them in since that join', () => {
    const joined = withViewer(written, '2026-11-01T00:00:00Z');
    const out = withViewer(written);
    // Lagging behind their join.
    expect(behind(write(joined), out)).toBe(true);
    expect(behind(write(joined), out, seenOf(out))).toBe(true);
    // In at that join, then out at the same update time: removed after.
    expect(behind(write(joined), out, seenOf(joined))).toBe(false);
    // In at an earlier join, which the write's join came after.
    const earlier = withViewer(written, '2026-10-01T00:00:00Z');
    expect(behind(write(joined), out, seenOf(earlier))).toBe(true);
  });

  it('is behind a write that has the viewer out while it shows them in as it first did', () => {
    const member = withViewer(written, '2026-11-01T00:00:00Z');
    const out = withViewer(written);
    expect(behind(write(out), member)).toBe(true);
    expect(behind(write(out), member, seenOf(member))).toBe(true);
    // They joined again after.
    expect(
      behind(
        write(out),
        withViewer(written, '2026-11-03T00:00:00Z'),
        seenOf(member)
      )
    ).toBe(false);
    expect(behind(write(out), out, seenOf(member))).toBe(false);
  });
});

describe('sightWrite', () => {
  it('keeps the first join it saw, and the last one that listed the viewer', () => {
    const first = withViewer(written, '2026-11-01T00:00:00Z');
    const later = withViewer(written, '2026-11-03T00:00:00Z');
    const seen = seenOf(first, withViewer(written), later, withViewer(written));
    expect(seen.held).toBe(true);
    expect(seen.baseline).toBe(seenOf(first).baseline);
    expect(seen.lastJoined).toBe(seenOf(later).lastJoined);
    expect(seenOf(undefined)).toBe(UNSEEN);
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
    settle(own, { [A]: written });
    const w = own.writes()[A];
    if (!w) throw new Error('no write');
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
    settle(own, { [A]: written });
    const w = own.writes()[A];
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    expect(tracker.pendingFor({ [A]: stale }, own.writes())).toEqual([[A, w]]);
    // The directory's own source never showed the channel, so its absence
    // is still lag.
    expect(tracker.pending({}, own.writes())).toEqual([[A, w]]);
    expect(tracker.pendingFor({ [A]: written }, own.writes())).toEqual([]);
    expect(tracker.pending({}, own.writes())).toEqual([[A, w]]);
  });

  it('counts what its source showed while the read was in flight', () => {
    const own = ownChannelWrites(new QueryClient());
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    tracker.pending({ [A]: stale }, own.writes());
    const sent = own.send(ACCOUNT, [A]);
    // Removed after the primary read the rename.
    tracker.pending({}, own.writes());
    sent.settle({ [A]: written });
    expect(tracker.pending({}, own.writes())).toEqual([]);
  });

  it('starts from what its source showed when the read was sent', () => {
    const own = ownChannelWrites(new QueryClient());
    const tracker = createOwnWriteTracker(own, ACCOUNT);
    tracker.pending({ [A]: stale }, own.writes());
    // Nothing changed while the read was in flight, and then the channel
    // went.
    settle(own, { [A]: written });
    expect(tracker.pending({}, own.writes())).toEqual([]);
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
    settle(own, { [A]: written });
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    const again = { ...written, name: 'again' };
    settle(own, { [A]: again, [B]: null });

    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()[A]?.channel).toBe(again);
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()).toEqual({});
  });

  it('never lets a read sent earlier replace one sent later, even after it went', () => {
    const own = ownChannelWrites(new QueryClient());
    const first = own.send(ACCOUNT, [A]);
    const second = own.send(ACCOUNT, [A]);
    const third = own.send(ACCOUNT, [A]);
    const newer = { ...written, name: 'newer' };
    third.settle({ [A]: newer });
    const held = own.writes()[A];
    expect(held?.channel).toBe(newer);
    second.settle({ [A]: written });
    expect(own.writes()[A]).toBe(held);
    if (held) own.release(A, held);
    first.settle({ [A]: written });
    expect(own.writes()).toEqual({});
  });

  it('keeps a read in flight until it settles, once', () => {
    const own = ownChannelWrites(new QueryClient());
    const sent = own.send(ACCOUNT, [A, B]);
    expect(own.inFlight()).toEqual([
      { sequence: sent.sequence, account: ACCOUNT, channelIds: [A, B] },
    ]);
    sent.settle({ [A]: written });
    expect(own.inFlight()).toEqual([]);
    expect(Object.keys(own.writes())).toEqual([A]);
    sent.settle({ [B]: null });
    expect(Object.keys(own.writes())).toEqual([A]);
  });

  it('lets every write go on clear, and drops the reads still in flight', () => {
    const own = ownChannelWrites(new QueryClient());
    settle(own, { [A]: written });
    const inFlight = own.send(ACCOUNT, [B]);
    own.clear();
    expect(own.writes()).toEqual({});
    expect(own.inFlight()).toEqual([]);
    inFlight.settle({ [B]: null });
    expect(own.writes()).toEqual({});
    settle(own, { [B]: null });
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
    settle(own, { [A]: written, [B]: null });
    dispose();
    expect(runs).toBe(2);
  });
});
