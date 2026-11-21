import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type ChannelDirectoryState,
  channelDirectoryState,
  EMPTY_CHANNEL_DIRECTORY_STATE,
  nextChannelDirectoryState,
} from './directory';
import type { DirectoryChannel } from './directory-core';
import { channelUuid } from './tests/channel-uuid';
import { directoryChannel } from './tests/directory-channel';

const SEEDS = [20261121, 20261120];
const IDS = Array.from({ length: 200 }, (_, n) => channelUuid(`state-${n}`));
// Few instants, written several ways, so ties and equal instants in other
// spellings are common.
const INSTANTS = [
  '2026-11-01T00:00:00Z',
  '2026-11-01T00:00:00+00:00',
  '2026-11-01T00:00:00.000001Z',
  '2026-11-02T00:00:00Z',
  '2026-11-02T00:00:00.000000+00:00',
  '2026-11-03T12:00:00.5Z',
];

type Step =
  | { kind: 'keep' }
  | { kind: 'change'; picks: number[]; instant: number }
  | { kind: 'touch'; picks: number[] }
  | { kind: 'leave'; picks: number[] }
  | { kind: 'remove'; picks: number[] }
  | { kind: 'add'; picks: number[]; instant: number }
  | { kind: 'rewrite-all'; instant: number };

const picks = fc.array(fc.nat(IDS.length - 1), { minLength: 1, maxLength: 90 });
const instant = fc.nat(INSTANTS.length - 1);
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.constant({ kind: 'keep' as const }),
  fc.record({ kind: fc.constant('change' as const), picks, instant }),
  fc.record({ kind: fc.constant('touch' as const), picks }),
  fc.record({ kind: fc.constant('leave' as const), picks }),
  fc.record({ kind: fc.constant('remove' as const), picks }),
  fc.record({ kind: fc.constant('add' as const), picks, instant }),
  fc.record({ kind: fc.constant('rewrite-all' as const), instant })
);

function apply(
  channels: Map<string, DirectoryChannel>,
  next: Step
): Map<string, DirectoryChannel> {
  const after = new Map(channels);
  const ids = (chosen: number[]) => chosen.map((n) => IDS[n] as string);
  if (next.kind === 'keep') return after;
  if (next.kind === 'rewrite-all') {
    for (const [id, channel] of after)
      after.set(id, {
        ...channel,
        updatedAt: INSTANTS[next.instant] as string,
      });
    return after;
  }
  for (const id of ids(next.picks)) {
    const channel = after.get(id);
    if (next.kind === 'add') {
      if (!channel)
        after.set(
          id,
          directoryChannel(id, { updatedAt: INSTANTS[next.instant] as string })
        );
      continue;
    }
    if (!channel) continue;
    if (next.kind === 'change') {
      after.set(id, {
        ...channel,
        name: `${channel.name}'`,
        updatedAt: INSTANTS[next.instant] as string,
      });
    } else if (next.kind === 'touch') {
      after.set(id, { ...channel });
    } else if (next.kind === 'leave') {
      after.set(id, { ...channel, isParticipant: !channel.isParticipant });
    } else {
      after.delete(id);
    }
  }
  return after;
}

const ids = (state: ChannelDirectoryState) => state.joined.map(({ id }) => id);

function expectSameState(
  built: ChannelDirectoryState,
  full: ChannelDirectoryState
) {
  expect(ids(built)).toEqual(ids(full));
  built.joined.forEach((channel, index) => {
    expect(channel).toBe(full.joined[index]);
  });
  expect(Object.keys(built.records).sort()).toEqual(
    Object.keys(full.records).sort()
  );
  for (const [id, channel] of Object.entries(full.records))
    expect(built.records[id]).toBe(channel);
  expect(built.incomplete).toEqual(full.incomplete);
  expect(built.complete).toBe(full.complete);
}

describe('nextChannelDirectoryState', () => {
  it.each(SEEDS)(
    'builds what a full rebuild builds after every step of random reads (seed %i)',
    (seed) => {
      fc.assert(
        fc.property(
          fc.array(fc.nat(IDS.length - 1), { maxLength: 120 }),
          instant,
          fc.array(
            fc.record({
              step,
              order: fc.array(fc.nat(), { maxLength: 8 }),
              incomplete: fc.array(fc.nat(IDS.length - 1), { maxLength: 4 }),
              complete: fc.boolean(),
            }),
            { minLength: 20, maxLength: 30 }
          ),
          (initial, at, steps) => {
            let channels = apply(new Map(), {
              kind: 'add',
              picks: initial.length > 0 ? initial : [0],
              instant: at,
            });
            let state = EMPTY_CHANNEL_DIRECTORY_STATE;
            for (const { step: next, order, incomplete, complete } of steps) {
              channels = apply(channels, next);
              // Reads list records in no promised order.
              const listed = [...channels.values()];
              for (const n of order) {
                const from = n % Math.max(listed.length, 1);
                const [moved] = listed.splice(from, 1);
                if (moved) listed.push(moved);
              }
              const incompleteIds = [
                ...new Set(incomplete.map((n) => IDS[n] as string)),
              ];
              const previous = state;
              state = nextChannelDirectoryState(
                previous,
                listed,
                incompleteIds,
                complete
              );
              expectSameState(
                state,
                channelDirectoryState(listed, incompleteIds, complete)
              );
              if (
                next.kind === 'keep' &&
                previous !== EMPTY_CHANNEL_DIRECTORY_STATE
              )
                expect(state.joined).toBe(previous.joined);
            }
          }
        ),
        { seed, numRuns: 150 }
      );
    }
  );

  it('returns the previous state for a read that changed nothing', () => {
    const channels = IDS.slice(0, 50).map((id) => directoryChannel(id));
    const first = nextChannelDirectoryState(
      EMPTY_CHANNEL_DIRECTORY_STATE,
      channels,
      [IDS[60] as string],
      true
    );
    expect(
      nextChannelDirectoryState(
        first,
        [...channels].reverse(),
        [IDS[60] as string],
        true
      )
    ).toBe(first);
  });
});
