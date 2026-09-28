import { LoroDoc } from 'loro-crdt';
import { createSignal } from 'solid-js';
import type { GamePresence, GameRoomSource } from '../context/game-room-source';

/**
 * Clients of one room, one per entry in `users` (a user may appear twice, as
 * two tabs). Document updates are relayed between their LoroDocs the way the
 * sync service would, and each client sees every other client's presence.
 */
export function createLinkedRoomSources(users: readonly string[]) {
  const docs = users.map(() => new LoroDoc());
  docs.forEach((doc, index) =>
    doc.subscribeLocalUpdates((update) => {
      docs.forEach((other, target) => {
        if (target !== index) other.import(update);
      });
    })
  );
  const presences = users.map(() => createSignal<GamePresence>());
  const peerId = (index: number) => `peer-${index}`;

  const source = (index: number): GameRoomSource => ({
    peerId: peerId(index),
    doc: () => docs[index],
    ready: () => true,
    error: () => undefined,
    status: () => 'connected',
    peers: () =>
      presences.flatMap(([presence], other) => {
        const current = presence();
        return other !== index && current
          ? [
              {
                peerId: peerId(other),
                userId: users[other],
                color: 'currentColor',
                presence: current,
              },
            ]
          : [];
      }),
    setPresence: (next) => presences[index][1](() => next),
  });

  return {
    sources: users.map((_, index) => source(index)),
    docs,
    presence: (index: number) => presences[index][0](),
    /** Publish presence for a client that runs no game, such as a closed tab. */
    setPresence: (index: number, next: GamePresence | undefined) =>
      presences[index][1](() => next),
  };
}
