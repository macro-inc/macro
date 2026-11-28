import { describe, expect, it } from 'vitest';
import {
  advanceMemberDiscovery,
  keepDiscoveredRecords,
  MEMBER_DISCOVERY_BATCH,
  MEMBER_DISCOVERY_MISSES,
  type MemberDiscovery,
  type MemberDiscoverySources,
  memberDiscoveryBudget,
  memberDiscoveryStatus,
} from './member-discovery';

const ids = (count: number) =>
  Array.from({ length: count }, (_, index) => `ch-${index}`);

const sources = (
  known: ReadonlySet<string>,
  unavailable: ReadonlySet<string>
): MemberDiscoverySources => ({
  isKnown: (id) => known.has(id),
  isUnavailable: (id) => unavailable.has(id),
});

/**
 * Drive discovery the way the rail does, answering each batch at once:
 * `found` members come back, the rest miss. The window remembers only the
 * last `remember` misses, as its retention does.
 */
function simulate(options: {
  members: readonly string[];
  found: (id: string) => boolean;
  remember: number;
  extensions?: number;
  maxLookups?: number;
}) {
  const known = new Set<string>();
  const missed: string[] = [];
  const lookups: string[][] = [];
  let discovery: MemberDiscovery | undefined;
  for (let step = 0; step < (options.maxLookups ?? 1000); step += 1) {
    const view = sources(known, new Set(missed.slice(-options.remember)));
    const budget = memberDiscoveryBudget(options.extensions ?? 0);
    discovery = advanceMemberDiscovery(
      discovery,
      options.members,
      view,
      budget
    );
    const status = memberDiscoveryStatus(discovery, view, budget);
    if (status.kind !== 'next') return { lookups, status, discovery, known };
    lookups.push([...status.ids]);
    for (const id of status.ids) {
      if (options.found(id)) known.add(id);
      else missed.push(id);
    }
  }
  throw new Error('discovery did not settle');
}

describe('member discovery', () => {
  it('looks up each unknown member once, in batches, and ends', () => {
    const members = ids(1000);
    const result = simulate({
      members,
      found: () => true,
      remember: 1000,
    });
    expect(result.status).toEqual({ kind: 'done' });
    expect(result.lookups).toHaveLength(1000 / MEMBER_DISCOVERY_BATCH);
    expect(new Set(result.lookups.flat()).size).toBe(1000);
  });

  it('skips members a source already holds', () => {
    const members = ids(100);
    const known = new Set(members.filter((_, index) => index % 2 === 0));
    const discovery = advanceMemberDiscovery(
      undefined,
      members,
      sources(known, new Set()),
      memberDiscoveryBudget(0)
    );
    expect(discovery.cursor).toBe(1);
    const status = memberDiscoveryStatus(
      discovery,
      sources(known, new Set()),
      memberDiscoveryBudget(0)
    );
    expect(status).toEqual({
      kind: 'next',
      ids: members.filter((_, index) => index % 2 === 1).slice(0, 25),
    });
  });

  it('never returns to misses its window forgot, and pauses at the budget', () => {
    // 7,000 members that every lookup misses; the window remembers 1,000.
    const members = ids(7000);
    const result = simulate({
      members,
      found: () => false,
      remember: 1000,
    });
    expect(result.status).toEqual({ kind: 'paused' });
    expect(result.discovery.misses).toBe(MEMBER_DISCOVERY_MISSES);
    const asked = result.lookups.flat();
    expect(new Set(asked).size).toBe(asked.length);
    expect(result.lookups).toHaveLength(
      MEMBER_DISCOVERY_MISSES / MEMBER_DISCOVERY_BATCH
    );
  });

  it('goes on past the budget after Load more, and still asks no member twice', () => {
    const members = ids(7000);
    const result = simulate({
      members,
      found: () => false,
      remember: 50,
      extensions: 3,
    });
    expect(result.status).toEqual({ kind: 'paused' });
    expect(result.discovery.misses).toBe(memberDiscoveryBudget(3));
    const asked = result.lookups.flat();
    expect(new Set(asked).size).toBe(asked.length);
  });

  it('keeps its place while nothing moves, and restarts on a new member list', () => {
    const members = ids(50);
    const view = sources(new Set(['ch-0']), new Set());
    const first = advanceMemberDiscovery(undefined, members, view, 100);
    expect(advanceMemberDiscovery(first, members, view, 100)).toBe(first);
    // The same members in a new array keep the cursor.
    expect(advanceMemberDiscovery(first, [...members], view, 100)).toBe(first);
    const changed = advanceMemberDiscovery(
      first,
      ['ch-new', ...members],
      view,
      100
    );
    expect(changed.cursor).toBe(0);
  });

  it('waits on a member another lookup is still loading', () => {
    const members = ids(30);
    const known = new Set(members.slice(0, 10));
    const discovery = advanceMemberDiscovery(
      undefined,
      members,
      sources(known, new Set()),
      100
    );
    expect(discovery.cursor).toBe(10);
    // Answered: the cursor passes the found and missed members together.
    const answered = advanceMemberDiscovery(
      discovery,
      members,
      sources(new Set(members.slice(0, 20)), new Set(members.slice(20, 30))),
      100
    );
    expect(answered).toEqual({ ids: members, cursor: 30, misses: 10 });
  });
});

describe('keepDiscoveredRecords', () => {
  const record = (id: string, version = 0) => ({ id, version });

  it('keeps what it found after the window drops it, until the section goes', () => {
    const members = new Set(ids(4));
    const first = keepDiscoveredRecords(new Map(), members, [
      record('ch-0'),
      record('ch-1'),
      record('outsider'),
    ]);
    expect([...first.keys()]).toEqual(['ch-0', 'ch-1']);
    // The window moved on: the next batch joins what was found before.
    const second = keepDiscoveredRecords(first, members, [record('ch-2')]);
    expect([...second.keys()]).toEqual(['ch-0', 'ch-1', 'ch-2']);
    // The section closed: its members go.
    expect(keepDiscoveredRecords(second, new Set(), []).size).toBe(0);
  });

  it('forgets a record once a settled lookup no longer returns its channel', () => {
    const members = new Set(ids(2));
    const first = keepDiscoveredRecords(new Map(), members, [
      record('ch-0'),
      record('ch-1'),
    ]);
    const next = keepDiscoveredRecords(first, members, [], new Set(['ch-0']));
    expect([...next.keys()]).toEqual(['ch-1']);
    expect(keepDiscoveredRecords(next, members, [], new Set(['ch-0']))).toBe(
      next
    );
  });

  it('takes the newest record and keeps its identity while nothing changes', () => {
    const members = new Set(ids(2));
    const found = [record('ch-0')];
    const first = keepDiscoveredRecords(new Map(), members, found);
    expect(keepDiscoveredRecords(first, members, found)).toBe(first);
    expect(keepDiscoveredRecords(first, members, []).get('ch-0')).toBe(
      found[0]
    );
    const fresher = record('ch-0', 1);
    expect(keepDiscoveredRecords(first, members, [fresher]).get('ch-0')).toBe(
      fresher
    );
  });
});
