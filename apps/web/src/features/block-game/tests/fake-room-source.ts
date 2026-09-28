import { LoroDoc } from 'loro-crdt';
import { createSignal } from 'solid-js';
import type {
  GamePeer,
  GamePresence,
  GameRoomSource,
} from '../context/game-room-source';

/**
 * A room source over a real in-memory LoroDoc, without transport. Tests drive
 * readiness, peers and edit rights through the returned controls.
 */
export function createFakeRoomSource(options: { ready?: boolean } = {}) {
  const doc = new LoroDoc();
  const [ready, setReady] = createSignal(options.ready ?? true);
  const [peers, setPeers] = createSignal<GamePeer[]>([]);
  const presence: (GamePresence | undefined)[] = [];
  const source: GameRoomSource = {
    peerId: 'local',
    doc: () => (ready() ? doc : undefined),
    ready,
    error: () => undefined,
    status: () => 'connected',
    peers,
    setPresence: (next) => presence.push(next),
  };
  return { source, doc, setReady, setPeers, presence };
}
