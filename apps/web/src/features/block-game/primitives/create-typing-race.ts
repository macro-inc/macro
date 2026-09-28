import { createMemo } from 'solid-js';
import { readRaceProgress, writeRaceProgress } from '../core/game-document';
import {
  MAX_RACERS,
  RACE_COUNTDOWN_MS,
  type RacerProgress,
  raceStage,
  raceStandings,
  replayTypingRace,
  TYPING_PASSAGES,
} from '../core/games/typing-race';
import { createRandom, randomInt, randomSeed } from '../core/random';
import { typingRaceStatus } from '../core/status';
import { createClock } from './create-clock';
import type { GameRoom } from './create-game-room';

/** Lobby, rounds, live progress and actions for a typing-race room. */
export function createTypingRace(room: GameRoom) {
  const race = createMemo(() => replayTypingRace(room.log()));
  const current = () => race().rounds.at(-1);
  const progress = createMemo(() => {
    room.revision();
    const doc = room.doc();
    const round = current();
    return doc && round
      ? readRaceProgress(doc, round.round)
      : new Map<string, RacerProgress>();
  });
  const liveAt = (time: number) => {
    const round = current();
    return !!round && raceStage(round, progress(), time).t !== 'finished';
  };
  // Tick only while the current round counts down or runs.
  const now = createClock(
    () => (liveAt(Date.now()) ? current()?.round : undefined),
    { stopWhen: (time) => !liveAt(time) }
  );
  const stage = () => {
    const round = current();
    return round ? raceStage(round, progress(), now()) : undefined;
  };
  const live = () => {
    const currentStage = stage();
    return currentStage !== undefined && currentStage.t !== 'finished';
  };
  const inLobby = () => {
    const userId = room.userId();
    return !!userId && race().lobby.includes(userId);
  };
  const isRacing = () => {
    const userId = room.userId();
    const round = current();
    const currentStage = stage();
    return (
      !!userId &&
      !!round &&
      round.racers.includes(userId) &&
      currentStage !== undefined &&
      currentStage.t !== 'finished'
    );
  };

  return {
    race,
    current,
    progress,
    stage,
    inLobby,
    isRacing,
    standings: () => {
      const round = current();
      return round ? raceStandings(round, progress()) : [];
    },
    status: () => typingRaceStatus(stage()),
    canJoin: () =>
      room.canPlay() && !inLobby() && race().lobby.length < MAX_RACERS,
    canLeave: () => room.canPlay() && inLobby(),
    canStart: () => room.canPlay() && inLobby() && !live(),
    join: () => room.append({ t: 'join' }),
    leave: () => room.append({ t: 'leave' }),
    startRace: () => {
      const random = createRandom(randomSeed());
      return room.append({
        t: 'race',
        round: race().rounds.length,
        startsAt: Date.now() + RACE_COUNTDOWN_MS,
        passage: randomInt(random, TYPING_PASSAGES.length),
      });
    },
    /** Share this racer's progress; only racers of the current round write. */
    reportProgress: (next: RacerProgress) => {
      const doc = room.doc();
      const userId = room.userId();
      const round = current();
      if (!doc || !userId || !round || !room.canPlay()) return;
      if (!round.racers.includes(userId)) return;
      writeRaceProgress(doc, round.round, userId, next);
    },
  };
}

export type TypingRaceState = ReturnType<typeof createTypingRace>;
