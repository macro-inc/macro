import { QueryClient } from '@tanstack/solid-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryChannel } from './directory-core';
import {
  OWN_WRITE_HOLD_MS,
  type OwnChannelWrite,
  overlayOwnWrites,
  ownChannelWrites,
  sourceBehindWrite,
} from './own-writes';
import { channelUuid } from './tests/channel-uuid';
import {
  directoryChannel,
  directoryParticipant,
} from './tests/directory-channel';

const VIEWER = 'macro|viewer@example.com';
const A = channelUuid('a');
const B = channelUuid('b');

const write = (
  channel: DirectoryChannel | null,
  userId = VIEWER
): OwnChannelWrite => ({ channel, userId });

const written = directoryChannel(A, {
  name: 'after',
  updatedAt: '2026-11-02T00:00:00+00:00',
  participants: [
    directoryParticipant('macro|one@example.com'),
    directoryParticipant('macro|two@example.com'),
  ],
});

describe('sourceBehindWrite', () => {
  it('is caught up when only the viewer’s own view, interaction or frecency moved', () => {
    expect(
      sourceBehindWrite(write(written), {
        ...written,
        viewedAt: '2026-11-03T00:00:00Z',
        interactedAt: '2026-11-03T00:00:00Z',
        frecencyScore: 4.5,
      })
    ).toBe(false);
  });

  it('compares people as sets and instants by value', () => {
    expect(
      sourceBehindWrite(write(written), {
        ...written,
        updatedAt: '2026-11-02T00:00:00.000000Z',
        participants: [...written.participants].reverse(),
      })
    ).toBe(false);
  });

  it('is behind while it shows the channel otherwise, or not at all', () => {
    expect(
      sourceBehindWrite(write(written), {
        ...written,
        name: 'before',
        updatedAt: '2026-11-01T00:00:00Z',
      })
    ).toBe(true);
    expect(
      sourceBehindWrite(write(written), {
        ...written,
        participants: written.participants.slice(1),
      })
    ).toBe(true);
    expect(sourceBehindWrite(write(written), undefined)).toBe(true);
  });

  it('is past the write once it shows a later update', () => {
    expect(
      sourceBehindWrite(write(written), {
        ...written,
        name: 'theirs',
        updatedAt: '2026-11-02T00:00:00.000001Z',
      })
    ).toBe(false);
  });

  it('is behind a channel the viewer can no longer read only while it lists them in it', () => {
    expect(sourceBehindWrite(write(null), written)).toBe(true);
    expect(
      sourceBehindWrite(write(null), { ...written, isParticipant: false })
    ).toBe(false);
    expect(sourceBehindWrite(write(null), undefined)).toBe(false);
  });
});

describe('overlayOwnWrites', () => {
  const stale = directoryChannel(A, { name: 'before' });
  const other = directoryChannel(B);

  it('lays the viewer’s writes over what was read, and settles their ids', () => {
    const overlaid = overlayOwnWrites(
      { [A]: stale, [B]: other },
      { [A]: true, [B]: true },
      { [A]: write(written) },
      VIEWER
    );
    expect(overlaid?.channels).toEqual([written, other]);
    expect(overlaid?.incompleteIds).toEqual([B]);
  });

  it('takes out a channel the viewer can no longer read', () => {
    expect(
      overlayOwnWrites(
        { [A]: stale, [B]: other },
        {},
        { [A]: write(null) },
        VIEWER
      )?.channels
    ).toEqual([other]);
  });

  it('changes nothing for writes the source shows or another viewer made', () => {
    expect(
      overlayOwnWrites(
        { [A]: written, [B]: other },
        {},
        { [A]: write(written), [B]: write(null, 'macro|other@example.com') },
        VIEWER
      )
    ).toBeUndefined();
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
    own.record(A, write(written));
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    const later = write({ ...written, name: 'again' });
    own.record(A, later);
    own.record(B, write(null));

    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()[A]).toBe(later);
    vi.advanceTimersByTime(OWN_WRITE_HOLD_MS / 2);
    expect(own.writes()).toEqual({});
  });
});
