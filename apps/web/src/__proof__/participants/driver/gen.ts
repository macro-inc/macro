// Seeded generators for the participants differential: the channels each
// sequence starts from and the write each step makes. Pure: the same seed
// gives the same plan, whatever the stack answers.

export type Rng = {
  next: () => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (p: number) => boolean;
  some: <T>(items: readonly T[], max: number) => T[];
};

/** mulberry32. */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) =>
    lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]) => items[int(0, items.length - 1)]!;
  const some = <T>(items: readonly T[], max: number) => {
    const pool = [...items];
    const out: T[] = [];
    const n = int(1, Math.max(1, Math.min(max, pool.length)));
    for (let i = 0; i < n && pool.length; i++)
      out.push(pool.splice(int(0, pool.length - 1), 1)[0]!);
    return out;
  };
  return { next, int, pick, chance: (p) => next() < p, some };
}

export type ChannelType = 'public' | 'private' | 'team' | 'direct_message';

/** A user by index: 0..VIEWERS-1 have open pages; the rest only sign in. */
export type U = number;

export type SizePlan = 'owner-only' | 'small' | 'medium' | 'page' | 'thousands';
export type OddPlan =
  | 'none'
  | 'ties'
  | 'unicode'
  | 'long-id'
  | 'left-rows'
  | 'same-instant-add';

export type ChannelPlan = {
  type: ChannelType;
  owner: U;
  initial: U[];
  size: SizePlan;
  odd: OddPlan;
  /** Long or unicode channel name; the reader ignores it, the coverage counts it. */
  name: string;
};

export type Op =
  | { kind: 'add' | 'remove'; actor: U; users: U[]; fail: boolean }
  | { kind: 'add-bot' | 'remove-bot'; actor: U }
  | { kind: 'leave' | 'join'; actor: U }
  | { kind: 'request-approve'; actor: U; requester: U }
  | { kind: 'autojoin'; actor: U; on: boolean }
  | { kind: 'role'; user: U; role: 'admin' | 'member' }
  | { kind: 'ties' }
  | { kind: 'synthetic'; count: number; unicode: boolean }
  | { kind: 'delete'; actor: U }
  | { kind: 'read' };

export const SIZE_COUNTS: Record<SizePlan, number> = {
  'owner-only': 0,
  small: 3,
  medium: 12,
  // The REST and soup reads have no participant page; 100 is the app's
  // largest common page size (soup `limit`), so it stands in for "a page".
  page: 100,
  thousands: 2_000,
};

const NAMES = [
  'proof',
  'Ünïcødé 频道 🚀 канал',
  'a'.repeat(240),
  'tab\tand  spaces',
  'ﷺ RTL שלום',
];

export function planChannel(
  r: Rng,
  users: number,
  viewers: number
): ChannelPlan {
  const type = r.pick<ChannelType>([
    'public',
    'public',
    'private',
    'private',
    'team',
    'team',
    'direct_message',
  ]);
  const owner = r.int(0, viewers - 1);
  const others = [...Array(users).keys()].filter((u) => u !== owner);
  const size =
    type === 'direct_message'
      ? 'small'
      : r.pick<SizePlan>([
          'owner-only',
          'small',
          'small',
          'small',
          'medium',
          'medium',
          'page',
          'thousands',
        ]);
  const initial =
    type === 'direct_message'
      ? [r.pick(others)]
      : size === 'owner-only'
        ? []
        : r.some(others, size === 'small' ? 3 : others.length);
  const odd =
    size === 'thousands' || type === 'direct_message'
      ? 'none'
      : r.pick<OddPlan>([
          'none',
          'none',
          'ties',
          'unicode',
          'long-id',
          'left-rows',
          'same-instant-add',
        ]);
  return { type, owner, initial, size, odd, name: r.pick(NAMES) };
}

/**
 * One step's write. `members` is what the generator believes (a hint: the
 * server is the truth, and a write it refuses is a case too).
 */
export function planOp(
  r: Rng,
  plan: ChannelPlan,
  members: ReadonlySet<U>,
  step: number,
  steps: number,
  users: number,
  viewers: number,
  deleted: boolean
): Op {
  if (deleted) return { kind: 'read' };
  const all = [...Array(users).keys()];
  const inside = all.filter((u) => members.has(u));
  const outside = all.filter((u) => !members.has(u));
  const viewersInside = inside.filter((u) => u < viewers);
  // Mostly the owner acts; sometimes someone who may not, so refusals happen.
  const actor = () =>
    r.chance(0.8) && members.has(plan.owner)
      ? plan.owner
      : r.int(0, viewers - 1);
  const roll = r.next();
  if (step === steps - 1 && r.chance(0.08))
    return { kind: 'delete', actor: actor() };
  if (roll < 0.26 && outside.length)
    return {
      kind: 'add',
      actor: actor(),
      users: r.some(outside, 3),
      fail: r.chance(0.12),
    };
  if (roll < 0.46 && inside.length) {
    // Rarely the owner, whom the server refuses to remove: a refusal case.
    const removable = inside.filter((u) => u !== plan.owner);
    const pool = removable.length && !r.chance(0.05) ? removable : inside;
    return {
      kind: 'remove',
      actor: actor(),
      users: r.some(pool, 2),
      fail: r.chance(0.12),
    };
  }
  if (roll < 0.52 && inside.length)
    return { kind: 'leave', actor: r.pick(inside) };
  if (roll < 0.58 && outside.length)
    return { kind: 'join', actor: r.pick(outside) };
  if (roll < 0.64 && outside.length)
    return {
      kind: 'request-approve',
      actor: actor(),
      requester: r.pick(outside),
    };
  if (roll < 0.7)
    return { kind: 'autojoin', actor: actor(), on: r.chance(0.6) };
  if (roll < 0.76)
    return { kind: r.chance(0.6) ? 'add-bot' : 'remove-bot', actor: actor() };
  if (roll < 0.83 && inside.length)
    return {
      kind: 'role',
      user: r.pick(inside),
      role: r.chance(0.5) ? 'admin' : 'member',
    };
  if (roll < 0.87) return { kind: 'ties' };
  if (roll < 0.9)
    return {
      kind: 'synthetic',
      count: r.pick([1, 3, 40]),
      unicode: r.chance(0.5),
    };
  if (roll < 0.92 && viewersInside.length)
    return { kind: 'leave', actor: r.pick(viewersInside) };
  return { kind: 'read' };
}
