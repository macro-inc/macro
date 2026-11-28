import {
  type DirectoryChannel,
  toChannelListItem,
} from '@queries/channel/directory-core';
import type { CachedGraphqlChannel } from '@queries/channel/graphql';
import type { ApiChannelWithLatest } from '@service-storage/channel-list-types';
import { describe, expect, it } from 'vitest';
import {
  directoryQuickAccessChannel,
  showsQuickAccessChannel,
} from './channel-rows';

/** The mapping this module replaced: directory → channel list → Quick Access. */
function viaChannelList(channel: DirectoryChannel): CachedGraphqlChannel {
  const item: ApiChannelWithLatest = toChannelListItem(channel);
  return {
    id: item.id,
    name: item.name ?? '',
    ownerId: item.owner_id ?? '',
    channelType: item.channel_type ?? 'public',
    participantIds: item.participants?.map((p) => p.user_id) ?? [],
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    viewedAt: item.viewed_at ?? undefined,
    interactedAt: item.interacted_at ?? undefined,
  };
}

/** A small seeded generator (mulberry32), so a failure names its case. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['direct_message', 'private', 'public', 'team'] as const;
const ROLES = ['owner', 'admin', 'member'] as const;
const when = (next: () => number) =>
  new Date(Date.UTC(2026, 0, 1) + Math.floor(next() * 3e10)).toISOString();

function directoryChannel(
  next: () => number,
  index: number,
  participants = Math.floor(next() * 6)
): DirectoryChannel {
  const pick = <T>(values: readonly T[]) =>
    values[Math.floor(next() * values.length)];
  const maybe = <T>(value: () => T) => (next() < 0.3 ? null : value());
  return {
    id: `channel-${index}`,
    name: next() < 0.15 ? null : pick(['', 'general', `channel ${index}`]),
    channelType: pick(TYPES),
    ownerId: `user-${Math.floor(next() * 9)}`,
    organizationId: maybe(() => '7'),
    teamId: maybe(() => 'team-1'),
    autoJoinTeam: next() < 0.5,
    createdAt: when(next),
    updatedAt: when(next),
    viewedAt: maybe(() => when(next)),
    interactedAt: maybe(() => when(next)),
    isParticipant: next() < 0.8,
    frecencyScore: maybe(() => next()),
    participants: Array.from({ length: participants }, (_, p) => ({
      userId: `user-${p}`,
      role: pick(ROLES),
      joinedAt: when(next),
      leftAt: maybe(() => when(next)),
    })),
    botParticipants: Array.from(
      { length: next() < 0.2 ? 1 + Math.floor(next() * 2) : 0 },
      (_, b) => ({
        botId: `bot-${b}`,
        role: pick(ROLES),
        joinedAt: when(next),
        leftAt: null,
      })
    ),
    agentDm: maybe(() => ({ botId: 'bot-0', name: 'Agent', avatarUrl: null })),
    latestMessage: null,
    latestNonThreadMessage: null,
  };
}

describe('directoryQuickAccessChannel', () => {
  it('gives the rows the channel-list mapping gave (2,000 generated channels)', () => {
    const next = random(12_380);
    for (let index = 0; index < 2_000; index += 1) {
      const channel = directoryChannel(next, index);
      expect(directoryQuickAccessChannel(channel), `case ${index}`).toEqual(
        viaChannelList(channel)
      );
    }
  });

  it('maps one record to one row', () => {
    const channel = directoryChannel(random(1), 0);
    expect(directoryQuickAccessChannel(channel)).toBe(
      directoryQuickAccessChannel(channel)
    );
    expect(directoryQuickAccessChannel({ ...channel })).not.toBe(
      directoryQuickAccessChannel(channel)
    );
  });
});

describe('showsQuickAccessChannel', () => {
  // Each change is one field a channel or its view time can change.
  const changes: Array<
    (row: CachedGraphqlChannel, next: () => number) => CachedGraphqlChannel
  > = [
    (row) => ({ ...row }),
    (row) => ({ ...row, name: `${row.name}!` }),
    (row) => ({ ...row, ownerId: 'user-other' }),
    (row) => ({
      ...row,
      channelType: row.channelType === 'public' ? 'private' : 'public',
    }),
    (row, next) => ({ ...row, createdAt: when(next) }),
    (row, next) => ({ ...row, updatedAt: when(next) }),
    (row, next) => ({
      ...row,
      interactedAt: next() < 0.5 ? undefined : when(next),
    }),
    (row) => ({ ...row, participantIds: [...row.participantIds] }),
    (row) => ({ ...row, participantIds: [...row.participantIds, 'user-new'] }),
    (row) => ({ ...row, participantIds: row.participantIds.slice(1) }),
    (row) => ({ ...row, participantIds: [...row.participantIds].reverse() }),
  ];

  // The comparison names its fields; this keeps it to every field. `Required`
  // fails the type check when the row gains a field this row lacks, and the
  // loop then fails until the comparison reads it.
  it('notices a change to any field of the row', () => {
    const row: Required<CachedGraphqlChannel> = {
      id: 'channel-1',
      name: 'general',
      ownerId: 'user-1',
      channelType: 'public',
      participantIds: ['user-1', 'bot|bot-1'],
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      viewedAt: '2026-08-03T00:00:00.000Z',
      interactedAt: '2026-08-04T00:00:00.000Z',
    };
    expect(showsQuickAccessChannel(row, { ...row }, row.viewedAt)).toBe(true);
    expect(showsQuickAccessChannel(row, row, undefined)).toBe(false);
    for (const field of Object.keys(row) as (keyof typeof row)[]) {
      if (field === 'viewedAt') continue;
      const value = row[field];
      const changed = {
        ...row,
        [field]: Array.isArray(value) ? [...value, 'other'] : `${value}-other`,
      };
      expect(showsQuickAccessChannel(row, changed, row.viewedAt), field).toBe(
        false
      );
    }
  });

  it('agrees with comparing the serialized rows (5,000 generated pairs)', () => {
    const next = random(9_001);
    for (let index = 0; index < 5_000; index += 1) {
      const source = directoryQuickAccessChannel(directoryChannel(next, index));
      const shownAt = next() < 0.3 ? undefined : when(next);
      const row = { ...source, viewedAt: shownAt };
      const changed = changes[Math.floor(next() * changes.length)](
        source,
        next
      );
      const viewedAt = next() < 0.5 ? shownAt : when(next);
      const before =
        JSON.stringify(row) === JSON.stringify({ ...changed, viewedAt });
      expect(
        showsQuickAccessChannel(row, changed, viewedAt),
        `case ${index}`
      ).toBe(before);
    }
  });
});

// The Quick Access channel index rebuilt over 6,500 channels of 75
// participants after one channel's view time changes: the work the index does
// per channel before and after this module. Run with QUICK_ACCESS_BENCH=1.
describe.skipIf(process.env.QUICK_ACCESS_BENCH !== '1')(
  'channel index rebuild (bench)',
  () => {
    it('measures the old and the new per-channel work', () => {
      const next = random(7);
      const directory = Array.from({ length: 6_500 }, (_, index) =>
        directoryChannel(next, index, 75)
      );
      const viewed = new Map<string, string>();
      const rounds = 30;
      const gc = (globalThis as { gc?: () => void }).gc;
      const measure = (rebuild: () => void) => {
        rebuild();
        const times: number[] = [];
        const heap: number[] = [];
        for (let round = 0; round < rounds; round += 1) {
          viewed.set(`channel-${round}`, when(next));
          gc?.();
          const heapBefore = process.memoryUsage().heapUsed;
          const started = performance.now();
          rebuild();
          times.push(performance.now() - started);
          heap.push(process.memoryUsage().heapUsed - heapBefore);
        }
        const median = (values: number[]) =>
          [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
        return {
          medianMs: Number(median(times).toFixed(2)),
          medianHeapKb: Math.round(median(heap) / 1024),
        };
      };

      const oldVersions = new Map<string, string>();
      const before = measure(() => {
        for (const record of directory) {
          const source = viaChannelList(record);
          const channel = {
            ...source,
            viewedAt: viewed.get(source.id) ?? source.viewedAt,
          };
          const version = JSON.stringify(channel);
          if (oldVersions.get(channel.id) !== version)
            oldVersions.set(channel.id, version);
        }
      });

      const rows = new Map<string, CachedGraphqlChannel>();
      const after = measure(() => {
        for (const record of directory) {
          const source = directoryQuickAccessChannel(record);
          const viewedAt = viewed.get(source.id) ?? source.viewedAt;
          const row = rows.get(source.id);
          if (!row || !showsQuickAccessChannel(row, source, viewedAt))
            rows.set(source.id, { ...source, viewedAt });
        }
      });

      console.log(
        JSON.stringify({
          channels: directory.length,
          rounds,
          gc: !!gc,
          before,
          after,
        })
      );
      expect(after.medianMs).toBeLessThan(before.medianMs);
    });
  }
);
