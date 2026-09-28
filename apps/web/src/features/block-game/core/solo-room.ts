import { isBetterScore } from './catalog';
import type { GameLogEntry } from './game-log';

export type SoloRun = { userId: string; score: number; at: number };

export function soloRuns(log: readonly GameLogEntry[]): SoloRun[] {
  return log.flatMap((entry) =>
    entry.t === 'run'
      ? [{ userId: entry.by, score: entry.score, at: entry.at }]
      : []
  );
}

/** Each player's best run in this room, best first. */
export function soloBests(
  runs: readonly SoloRun[],
  order: 'desc' | 'asc'
): SoloRun[] {
  const best = new Map<string, SoloRun>();
  for (const run of runs) {
    const current = best.get(run.userId);
    if (isBetterScore(order, run.score, current?.score))
      best.set(run.userId, run);
  }
  return [...best.values()].sort((a, b) =>
    a.score === b.score
      ? a.at - b.at
      : order === 'desc'
        ? b.score - a.score
        : a.score - b.score
  );
}
