/**
 * What a sequence should leave behind, worked out without a browser. One
 * model says what a build that keeps channels on the device should end with
 * (`on`: a write made while cut off waits and is delivered when the
 * connection returns), the other what a build that reads and writes over
 * REST should (`off`: a write made with no connection waits in the open
 * page and is sent when the connection returns; one whose request fails is
 * lost). A difference between the two builds that the two models also have
 * is the intended one. `POLICY` holds the one place they differ.
 */
import type { PersonKey } from '../harness/people';
import type { Cut, Windowed } from './gen';

export type Side = 'on' | 'off';

/** `m<n>` for a message an operation wrote, `p<n>` for one there before. */
export type Key = string;

export type Message = {
  key: Key;
  author: PersonKey;
  parent: Key | null;
  /** 0 as written; the `n` of the edit that last changed it. */
  version: number;
  deleted: boolean;
  reactions: Record<string, PersonKey[]>;
  /** The step at which the services got it: order is only known between steps. */
  group: number;
};

export type Act =
  | { k: 'send'; actor: PersonKey; key: Key; parent: Key | null }
  | { k: 'edit'; actor: PersonKey; target: Key; version: number }
  | { k: 'delete'; actor: PersonKey; target: Key }
  | {
      k: 'react';
      actor: PersonKey;
      target: Key;
      emoji: string;
      /** Set on a held reaction: what the page that made it asked for. */
      add?: boolean;
    };

export type Outcome =
  /** The services have it. */
  | 'applied'
  /** The device holds it until the connection returns. */
  | 'queued'
  /** Made on a device that cannot deliver or keep it. */
  | 'dropped'
  /** Not possible in what this build shows the person, so not attempted. */
  | 'skipped';

type State = {
  roots: Key[];
  replies: Record<Key, Key[]>;
  messages: Record<Key, Message>;
};

type Fate = 'queue' | 'drop' | 'apply' | 'first';

/** What becomes of a write made on a device cut off this way. */
const POLICY: Record<Side, Record<Cut, Fate>> = {
  // With answers lost, the first write is carried out and never confirmed,
  // so the device goes on sending it and holds every later one behind it.
  on: { offline: 'queue', block: 'queue', lossy: 'first' },
  // A browser that knows it has no connection holds the request and sends
  // it when the connection is back, for as long as the page stays open; a
  // sequence never loads a page again while it is offline.
  off: { offline: 'queue', block: 'drop', lossy: 'apply' },
};

/** How many of the newest messages a person acts on in a window. */
const RECENT = 20;

export const DELETED = 'This message was deleted.';

export function textOf(seed: number, key: Key, version: number): string {
  return `q${seed}${key} v${version}`;
}

function clone(state: State): State {
  return JSON.parse(JSON.stringify(state)) as State;
}

/** Makes the change if it is possible in this state; says whether it was. */
function change(state: State, act: Act, group: number): boolean {
  if (act.k === 'send') {
    if (act.parent !== null) {
      const parent = state.messages[act.parent];
      if (!parent || parent.deleted || parent.parent !== null) return false;
      state.replies[act.parent] = [
        ...(state.replies[act.parent] ?? []),
        act.key,
      ];
    } else {
      state.roots.push(act.key);
    }
    state.messages[act.key] = {
      key: act.key,
      author: act.actor,
      parent: act.parent,
      version: 0,
      deleted: false,
      reactions: {},
      group,
    };
    return true;
  }
  const target = state.messages[act.target];
  if (!target || target.deleted) return false;
  if (act.k === 'react') {
    const people = target.reactions[act.emoji] ?? [];
    const add = act.add ?? !people.includes(act.actor);
    const others = people.filter((person) => person !== act.actor);
    target.reactions[act.emoji] = add ? [...others, act.actor] : others;
    return true;
  }
  if (target.author !== act.actor) return false;
  if (act.k === 'edit') {
    target.version = act.version;
    return true;
  }
  // A deleted message with replies keeps its place; any other is gone.
  if (target.parent !== null) {
    state.replies[target.parent] = state.replies[target.parent].filter(
      (key) => key !== target.key
    );
    delete state.messages[target.key];
  } else if ((state.replies[target.key] ?? []).length > 0) {
    target.deleted = true;
    target.reactions = {};
  } else {
    state.roots = state.roots.filter((key) => key !== target.key);
    delete state.messages[target.key];
  }
  return true;
}

function lineOf(seed: number, message: Message): string {
  if (message.deleted) return DELETED;
  const reactions = Object.entries(message.reactions)
    .filter(([, people]) => people.length > 0)
    .map(([emoji, people]) =>
      people.length > 1 ? `${emoji} ${people.length}` : emoji
    )
    .sort();
  const text = textOf(seed, message.key, message.version);
  return reactions.length > 0 ? `${text} [${reactions.join(' ')}]` : text;
}

export class Model {
  private server: State = { roots: [], replies: {}, messages: {} };
  private cuts = new Map<
    Windowed,
    {
      how: Cut;
      /** The channel as it was at the cut, with every write made since. */
      frozen: State;
      /** The same with only the writes the services took. */
      base: State;
      pending: { act: Act; place?: string }[];
      written: number;
    }
  >();
  /** Writes the services refused when a device delivered what it held. */
  refused: Act[] = [];

  constructor(
    readonly side: Side,
    private readonly seed: number
  ) {}

  /** A message that is there before the first operation. */
  prefill(key: Key, author: PersonKey, parent: Key | null = null): void {
    change(this.server, { k: 'send', actor: author, key, parent }, 0);
  }

  howCut(person: PersonKey): Cut | undefined {
    return this.cuts.get(person as Windowed)?.how;
  }

  private policy(person: PersonKey): Fate | undefined {
    const cut = this.cuts.get(person as Windowed);
    if (!cut) return undefined;
    const fate = POLICY[this.side][cut.how];
    if (fate !== 'first') return fate;
    return cut.written === 0 ? 'apply' : 'queue';
  }

  /**
   * The channel as this person's windows should show it. A device that keeps
   * channels holds a waiting write for all its windows; over REST it waits in
   * the page it was made in, so `place` names the window asked about.
   */
  private world(person: PersonKey, place?: string): State {
    const cut = this.cuts.get(person as Windowed);
    if (!cut) return this.server;
    if (cut.how === 'offline') {
      if (this.side === 'on' || place === undefined) return cut.frozen;
      const world = clone(cut.base);
      for (const held of cut.pending) {
        if (held.place === place) change(world, held.act, 0);
      }
      return world;
    }
    if (cut.pending.length === 0) return this.server;
    // Cut off only for writes, the device still hears of everyone else's.
    const world = clone(this.server);
    for (const held of cut.pending) change(world, held.act, 0);
    return world;
  }

  cut(person: Windowed, how: Cut): void {
    if (this.cuts.has(person)) return;
    this.cuts.set(person, {
      how,
      frozen: clone(this.server),
      base: clone(this.server),
      pending: [],
      written: 0,
    });
  }

  /** Delivers what the device held, in the order it was written. */
  restore(person: Windowed, group: number): void {
    const cut = this.cuts.get(person);
    if (!cut) return;
    this.cuts.delete(person);
    for (const { act } of cut.pending) {
      if (!change(this.server, act, group)) this.refused.push(act);
    }
  }

  /** Whether the write is possible in what the person's windows show. */
  possible(act: Act, place?: string): boolean {
    return change(clone(this.world(act.actor, place)), act, 0);
  }

  /** `place` is the window the write is made in, when it is made in one. */
  write(act: Act, group: number, place?: string): Outcome {
    if (!this.possible(act, place)) return 'skipped';
    const policy = this.policy(act.actor);
    if (!policy || policy === 'apply') {
      change(this.server, act, group);
      const cut = this.cuts.get(act.actor as Windowed);
      if (cut) {
        cut.written += 1;
        change(cut.frozen, act, group);
        change(cut.base, act, group);
      }
      return 'applied';
    }
    if (policy === 'drop') return 'dropped';
    const cut = this.cuts.get(act.actor as Windowed);
    if (!cut) throw new Error('a write is queued only on a cut device');
    // A page asks for a reaction to be added or removed by what it shows,
    // and two pages of one person can each ask for the same.
    const held =
      act.k === 'react'
        ? {
            ...act,
            add: !this.hasReacted(act.actor, act.target, act.emoji, place),
          }
        : act;
    cut.pending.push({ act: held, place });
    change(cut.frozen, act, group);
    return 'queued';
  }

  /** Whether the person has this reaction on the message, as they see it. */
  hasReacted(
    person: PersonKey,
    target: Key,
    emoji: string,
    place?: string
  ): boolean {
    return (
      this.world(person, place).messages[target]?.reactions[emoji]?.includes(
        person
      ) ?? false
    );
  }

  message(person: PersonKey, key: Key, place?: string): Message | undefined {
    return this.world(person, place).messages[key];
  }

  /**
   * The messages a person could do this to, as they see the channel. In a
   * window that is the newest part of it; through the services, all of it.
   */
  candidates(
    person: PersonKey,
    what: 'reply' | 'edit' | 'delete' | 'react',
    everywhere: boolean
  ): Key[] {
    const world = this.world(person);
    const roots = everywhere ? world.roots : world.roots.slice(-RECENT);
    const keys =
      what === 'reply'
        ? roots
        : roots.flatMap((root) => [root, ...(world.replies[root] ?? [])]);
    return keys.filter((key) => {
      const message = world.messages[key];
      if (message.deleted) return false;
      return what === 'reply' || what === 'react' || message.author === person;
    });
  }

  /** Top-level messages, oldest first, as the person sees the channel. */
  roots(person: PersonKey): Key[] {
    return [...this.world(person).roots];
  }

  /**
   * The channel, written as `serverChannel` and `shown` write it: what the
   * services should hold, or what one person's windows should show (one
   * window of theirs, when `place` names it).
   */
  lines(person?: PersonKey, place?: string): string[] {
    const state = person ? this.world(person, place) : this.server;
    return state.roots.flatMap((root) => [
      lineOf(this.seed, state.messages[root]),
      ...(state.replies[root] ?? []).map(
        (reply) => `  > ${lineOf(this.seed, state.messages[reply])}`
      ),
    ]);
  }

  /** The step at which the services got each message they hold. */
  groups(): Record<Key, number> {
    return Object.fromEntries(
      Object.values(this.server.messages).map((message) => [
        message.key,
        message.group,
      ])
    );
  }

  authors(): Record<Key, PersonKey> {
    return Object.fromEntries(
      Object.values(this.server.messages).map((message) => [
        message.key,
        message.author,
      ])
    );
  }
}
