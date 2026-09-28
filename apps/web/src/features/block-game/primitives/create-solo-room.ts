import { createMemo } from 'solid-js';
import type { GameKind } from '../core/catalog';
import { gameDefinition } from '../core/catalog';
import { soloBests, soloRuns } from '../core/solo-room';
import { soloRoomStatus } from '../core/status';
import type { GameRoom } from './create-game-room';

/** Finished runs, the room's own bests, and who is mid-run right now. */
export function createSoloRoom(room: GameRoom, kind: GameKind) {
  const scoring = gameDefinition(kind).scoring;
  const order = scoring.t === 'high-score' ? scoring.order : 'desc';
  const runs = createMemo(() => soloRuns(room.log()));
  const playingPeers = () =>
    room.peers().filter((peer) => peer.presence.activity === 'playing');

  return {
    runs,
    bests: createMemo(() => soloBests(runs(), order)),
    playingPeers,
    status: (localPlaying: boolean) =>
      soloRoomStatus({
        playing: localPlaying || playingPeers().length > 0,
        runs: runs().length,
      }),
    /** Keep a finished run in the room's history when the player can edit it. */
    recordRun: (score: number) =>
      room.append({ t: 'run', score, at: Date.now() }),
  };
}

export type SoloRoomState = ReturnType<typeof createSoloRoom>;
