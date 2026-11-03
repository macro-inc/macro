/**
 * The fuzzer's input as fast-check commands over `FuzzModel` (each person's
 * `PeerModel`) and `FuzzSystem` (their pages and the relay): one person
 * pressing a key, going offline or online, or the relay delivering a few
 * messages. A command whose precondition fails at its turn is skipped, and
 * shrinking drops the ones a failure does not need.
 */

import fc from 'fast-check';
import { match } from 'ts-pattern';
import { markerOf, type Peer, press } from './harness';
import { type Key, PeerModel, SHORTCUT_PREFIXES } from './model';
import { FindingsError } from './oracles';
import type { Relay } from './relay';

export class FuzzModel {
  private readonly peers: Map<string, PeerModel>;

  constructor(names: string[]) {
    this.peers = new Map(
      names.map((name) => [name, new PeerModel(markerOf(name))])
    );
  }

  peer(name: string): PeerModel {
    const peer = this.peers.get(name);
    if (!peer) throw new Error(`no model for ${name}`);
    return peer;
  }
}

export class FuzzSystem {
  constructor(
    readonly peers: Peer[],
    readonly relay: Relay
  ) {}

  peer(name: string): Peer {
    const peer = this.peers.find((candidate) => candidate.name === name);
    if (!peer) throw new Error(`no peer ${name}`);
    return peer;
  }
}

type FuzzCommand = fc.AsyncCommand<FuzzModel, FuzzSystem>;

const describeKey = (key: Key) =>
  match(key)
    .with({ kind: 'type' }, ({ text, delay }) =>
      delay > 0
        ? `types ${JSON.stringify(text)} (${delay}ms apart)`
        : `types ${JSON.stringify(text)}`
    )
    .with(
      { kind: 'shortcut' },
      ({ prefix }) => `types ${JSON.stringify(prefix)}`
    )
    .with({ kind: 'code' }, () => 'types ``` Enter')
    .with({ kind: 'enter' }, () => 'presses Enter')
    .with({ kind: 'linebreak' }, () => 'presses Shift+Enter')
    .with({ kind: 'backspace' }, () => 'presses Backspace')
    .exhaustive();

/** `name` presses `key`; the caret must then be at the end of the model's current block. */
function keyCommand(name: string, key: Key): FuzzCommand {
  return {
    check: (model) => model.peer(name).allows(key),
    run: async (model, system) => {
      const peer = system.peer(name);
      const peerModel = model.peer(name);
      await press(peer.page, key);
      peerModel.apply(key);
      const caret = await peer.api.evaluate((api) => api.selection());
      const expected = peerModel.current;
      if (
        !caret ||
        !caret.collapsed ||
        caret.text !== expected.text ||
        caret.before !== expected.text ||
        caret.blockType !== expected.type
      )
        throw new FindingsError([
          {
            kind: 'caret',
            peer: name,
            phase: 'typed',
            detail: { key, caret, expected, region: peerModel.blocks },
          },
        ]);
    },
    toString: () => `${name} ${describeKey(key)}`,
  };
}

function offlineCommand(name: string): FuzzCommand {
  return {
    check: (model) => model.peer(name).online,
    run: async (model, system) => {
      system.relay.hold(name);
      model.peer(name).online = false;
    },
    toString: () => `${name} goes offline`,
  };
}

function onlineCommand(name: string): FuzzCommand {
  return {
    check: (model) => !model.peer(name).online,
    run: async (model, system) => {
      system.relay.release(name);
      model.peer(name).online = true;
    },
    toString: () => `${name} comes back online`,
  };
}

function deliverCommand(count: number): FuzzCommand {
  return {
    check: () => true,
    run: async (_model, system) => system.relay.deliver(count),
    toString: () => `relay delivers ${count}`,
  };
}

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];

/** A word, sometimes indented (only allowed in code) or followed by a space. */
const WORD = fc
  .tuple(
    fc.oneof(
      { arbitrary: fc.constant(''), weight: 4 },
      { arbitrary: fc.constant('  '), weight: 1 }
    ),
    fc.string({
      unit: fc.constantFrom(...LETTERS),
      minLength: 1,
      maxLength: 8,
    }),
    fc.constantFrom('', ' ')
  )
  .map(([indentation, letters, space]) => `${indentation}${letters}${space}`);

/** Milliseconds between typed characters; slow typing splits undo groups. */
const DELAY = fc.oneof(
  { arbitrary: fc.constant(0), weight: 4 },
  { arbitrary: fc.integer({ min: 0, max: 24 }), weight: 1 }
);

const KEY: fc.Arbitrary<Key> = fc.oneof(
  {
    arbitrary: fc
      .record({ text: WORD, delay: DELAY })
      .map(({ text, delay }): Key => ({ kind: 'type', text, delay })),
    weight: 45,
  },
  { arbitrary: fc.constant<Key>({ kind: 'enter' }), weight: 15 },
  { arbitrary: fc.constant<Key>({ kind: 'linebreak' }), weight: 5 },
  { arbitrary: fc.constant<Key>({ kind: 'backspace' }), weight: 14 },
  {
    arbitrary: fc
      .constantFrom(...SHORTCUT_PREFIXES)
      .map((prefix): Key => ({ kind: 'shortcut', prefix })),
    weight: 12,
  },
  { arbitrary: fc.constant<Key>({ kind: 'code' }), weight: 4 }
);

/** Every command `names` can run, weighted towards typing. */
export function fuzzCommand(names: string[]): fc.Arbitrary<FuzzCommand> {
  const name = fc.constantFrom(...names);
  return fc.oneof(
    {
      arbitrary: fc.tuple(name, KEY).map(([who, key]) => keyCommand(who, key)),
      weight: 70,
    },
    {
      arbitrary: fc.integer({ min: 1, max: 20 }).map(deliverCommand),
      weight: 25,
    },
    { arbitrary: name.map(offlineCommand), weight: 2 },
    { arbitrary: name.map(onlineCommand), weight: 2 }
  );
}
