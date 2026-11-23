/**
 * The sequences the differential fuzzer runs: what an operation is, and how
 * a seed becomes a list of them. Nothing here touches a browser, so the same
 * seed gives the same list on every build and every machine.
 */

/** The windows of a sequence: two of Ada's in one profile, one each of Ben's and Cy's. */
export const WINDOWS = { a1: 'ada', a2: 'ada', b1: 'ben', c1: 'cy' } as const;
export type Win = keyof typeof WINDOWS;
/** The people who have a window. Dee takes part through the services only. */
export type Windowed = (typeof WINDOWS)[Win];
export const WINDOWED: Windowed[] = ['ada', 'ben', 'cy'];
export const WINS = Object.keys(WINDOWS) as Win[];

/**
 * How a device is cut off: `offline` loses the network, `block` drops its
 * message writes while the app still loads, `lossy` lets writes through and
 * loses their answers.
 */
export type Cut = 'offline' | 'block' | 'lossy';

/**
 * `n` numbers the text an operation writes, so a message keeps its text when
 * operations before it are removed. `pick` chooses among the messages the
 * operation could act on when it runs: it is taken modulo how many there are.
 */
export type Write =
  | { k: 'send'; w: Win; n: number }
  | { k: 'reply'; w: Win; n: number; pick: number }
  | { k: 'edit'; w: Win; n: number; pick: number }
  | { k: 'delete'; w: Win; pick: number }
  | { k: 'react'; w: Win; pick: number; emoji: string }
  | { k: 'apiSend'; n: number }
  | { k: 'apiReply'; n: number; pick: number }
  | { k: 'apiEdit'; n: number; pick: number }
  | { k: 'apiDelete'; pick: number }
  | { k: 'apiReact'; pick: number; emoji: string };

export type Op =
  | Write
  | { k: 'reload'; w: Win }
  /** Opens the sequence's other channel from the list and comes back. */
  | { k: 'visit'; w: Win }
  /** Turns the wheel back through the channel. */
  | { k: 'page'; w: Win; wheels: number }
  /** Opens the channel at one of its oldest messages, by a link to it. */
  | { k: 'jump'; w: Win; pick: number }
  | { k: 'bottom'; w: Win }
  | { k: 'cut'; p: Windowed; how: Cut }
  | { k: 'restore'; p: Windowed }
  /** Reads the window as it stands. */
  | { k: 'look'; w: Win }
  /** Waits for every connected window to show what the services hold. */
  | { k: 'settle' }
  /** Operations of different people started at the same moment. */
  | { k: 'par'; ops: (Write | { k: 'restore'; p: Windowed })[] };

export type Profile = 'short' | 'long';

export type Case = {
  seed: number;
  profile: Profile;
  ops: Op[];
};

/** Messages in the channel before the first operation. */
export const PREFILL: Record<Profile, number> = { short: 6, long: 140 };

export const QUICK_EMOJI = ['👍', '❤️'];
const API_EMOJI = ['👍', '❤️', '🎉'];

/** A small seeded generator (mulberry32): the same seed, the same numbers. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function profileOf(seed: number): Profile {
  return seed % 4 === 0 ? 'long' : 'short';
}

/** How many operations a sequence has, counting those inside a `par`. */
export function countOps(ops: Op[]): number {
  return ops.reduce((n, op) => n + (op.k === 'par' ? op.ops.length : 1), 0);
}

export function generate(seed: number, length = 40): Case {
  const next = rng(seed * 2654435761 + 97);
  const int = (n: number) => Math.floor(next() * n);
  const of = <T>(items: readonly T[]): T => items[int(items.length)];
  const profile = profileOf(seed);
  let n = 0;
  const fresh = () => {
    n += 1;
    return n;
  };
  const cut = new Map<Windowed, Cut>();
  const sinceCut = new Map<Windowed, number>();

  const write = (w: Win): Write => {
    const roll = next();
    if (roll < 0.4) return { k: 'send', w, n: fresh() };
    if (roll < 0.55) return { k: 'reply', w, n: fresh(), pick: int(1000) };
    if (roll < 0.72) return { k: 'edit', w, n: fresh(), pick: int(1000) };
    if (roll < 0.84) return { k: 'delete', w, pick: int(1000) };
    return { k: 'react', w, pick: int(1000), emoji: of(QUICK_EMOJI) };
  };
  const apiWrite = (): Write => {
    const roll = next();
    if (roll < 0.45) return { k: 'apiSend', n: fresh() };
    if (roll < 0.6) return { k: 'apiReply', n: fresh(), pick: int(1000) };
    if (roll < 0.75) return { k: 'apiEdit', n: fresh(), pick: int(1000) };
    if (roll < 0.85) return { k: 'apiDelete', pick: int(1000) };
    return { k: 'apiReact', pick: int(1000), emoji: of(API_EMOJI) };
  };
  const windowOf = (p: Windowed): Win =>
    p === 'ada' ? of(['a1', 'a2'] as const) : p === 'ben' ? 'b1' : 'c1';

  const ops: Op[] = [];
  while (countOps(ops) < length) {
    // A cut device writes a few things, is looked at, and comes back.
    const cutPeople = [...cut.keys()];
    if (cutPeople.length > 0 && next() < 0.55) {
      const p = of(cutPeople);
      const done = sinceCut.get(p) ?? 0;
      sinceCut.set(p, done + 1);
      const w = windowOf(p);
      if (done >= 2 && next() < 0.4) {
        if (next() < 0.3) {
          ops.push({ k: 'par', ops: [{ k: 'restore', p }, apiWrite()] });
        } else {
          ops.push({ k: 'restore', p });
        }
        cut.delete(p);
        continue;
      }
      const roll = next();
      if (roll < 0.6) ops.push(write(w));
      else if (roll < 0.75) ops.push({ k: 'look', w });
      else if (roll < 0.87) ops.push({ k: 'visit', w });
      else ops.push({ k: 'reload', w });
      continue;
    }

    // A long channel is also read back through and opened at old messages.
    if (profile === 'long' && next() < 0.2) {
      const w = of(WINS);
      const kind = next();
      if (kind < 0.45) ops.push({ k: 'page', w, wheels: 2 + int(6) });
      else if (kind < 0.8) ops.push({ k: 'jump', w, pick: int(1000) });
      else ops.push({ k: 'bottom', w });
      continue;
    }

    const roll = next();
    if (roll < 0.34) {
      ops.push(write(of(WINS)));
    } else if (roll < 0.46) {
      ops.push(apiWrite());
    } else if (roll < 0.6) {
      // Two or three people at once, each in a window of their own.
      const people = WINDOWED.filter(() => next() < 0.7);
      const batch: Write[] = people.map((p) => write(windowOf(p)));
      if (next() < 0.5) batch.push(apiWrite());
      if (batch.length >= 2) ops.push({ k: 'par', ops: batch });
    } else if (roll < 0.7) {
      const free = WINDOWED.filter((p) => !cut.has(p));
      if (free.length > 1) {
        const p = of(free);
        const how: Cut = of(['offline', 'offline', 'block', 'lossy'] as const);
        cut.set(p, how);
        sinceCut.set(p, 0);
        ops.push({ k: 'cut', p, how });
      }
    } else if (roll < 0.76) {
      ops.push({ k: 'reload', w: of(WINS) });
    } else if (roll < 0.81) {
      ops.push({ k: 'visit', w: of(WINS) });
    } else if (roll < 0.86) {
      ops.push({ k: 'look', w: of(WINS) });
    } else if (roll < 0.9) {
      ops.push({ k: 'settle' });
    } else {
      ops.push(write(of(WINS)));
    }
  }
  for (const p of cut.keys()) ops.push({ k: 'restore', p });
  return { seed, profile, ops };
}

/** One operation as a short line, for a report a person reads. */
export function describe(op: Op): string {
  switch (op.k) {
    case 'send':
      return `${op.w} sends message ${op.n}`;
    case 'reply':
      return `${op.w} replies (${op.n}) to message #${op.pick}`;
    case 'edit':
      return `${op.w} edits own message #${op.pick} (text ${op.n})`;
    case 'delete':
      return `${op.w} deletes own message #${op.pick}`;
    case 'react':
      return `${op.w} reacts ${op.emoji} to message #${op.pick}`;
    case 'apiSend':
      return `dee sends message ${op.n} through the services`;
    case 'apiReply':
      return `dee replies (${op.n}) to message #${op.pick} through the services`;
    case 'apiEdit':
      return `dee edits own message #${op.pick} (text ${op.n}) through the services`;
    case 'apiDelete':
      return `dee deletes own message #${op.pick} through the services`;
    case 'apiReact':
      return `dee reacts ${op.emoji} to message #${op.pick} through the services`;
    case 'reload':
      return `${op.w} reloads`;
    case 'visit':
      return `${op.w} opens the other channel and comes back`;
    case 'page':
      return `${op.w} scrolls back ${op.wheels} turns`;
    case 'jump':
      return `${op.w} opens a link to old message #${op.pick}`;
    case 'bottom':
      return `${op.w} scrolls to the newest message`;
    case 'cut':
      return op.how === 'offline'
        ? `${op.p}'s device goes offline`
        : op.how === 'block'
          ? `${op.p}'s message writes stop reaching the services`
          : `${op.p}'s message writes arrive but their answers are lost`;
    case 'restore':
      return `${op.p}'s connection is restored`;
    case 'look':
      return `${op.w} is read`;
    case 'settle':
      return 'everything is left to settle and every connected window is read';
    case 'par':
      return `at once: ${op.ops.map(describe).join(' | ')}`;
  }
}
