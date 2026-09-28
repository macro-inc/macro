import type { LoroDoc } from 'loro-crdt';
import { type GameKind, isGameKind } from './catalog';
import {
  encodeGameLogEntry,
  type GameLogEntry,
  parseGameLog,
} from './game-log';
import {
  parseRacerProgress,
  type RacerProgress,
  raceProgressKey,
} from './games/typing-race';

/**
 * Loro layout of a game room:
 * - `gameMeta`: `formatVersion` and the room's `kind`, written once.
 * - `gameLog`: the append-only list of JSON-encoded log entries.
 * - `raceProgress`: typing-race progress keyed `<round>:<userId>`; each racer
 *   only ever writes their own keys, so updates never conflict.
 */
export const GAME_FORMAT_VERSION = 1;

const META = 'gameMeta';
const LOG = 'gameLog';
const RACE_PROGRESS = 'raceProgress';

export type GameDocumentMeta = {
  kind: GameKind | undefined;
  formatVersion: number | undefined;
};

export function readGameMeta(doc: LoroDoc): GameDocumentMeta {
  const meta = doc.getMap(META);
  const kind = meta.get('kind');
  const formatVersion = meta.get('formatVersion');
  return {
    kind: isGameKind(kind) ? kind : undefined,
    formatVersion:
      typeof formatVersion === 'number' ? formatVersion : undefined,
  };
}

/**
 * Record which game this room hosts. The backend seeds every room with only
 * `formatVersion` (static_assets/game-golden.1.bin), so the first editor to
 * open it writes the kind; later calls are no-ops.
 */
export function ensureGameMeta(doc: LoroDoc, kind: GameKind): boolean {
  const current = readGameMeta(doc);
  if (current.kind) return false;
  const meta = doc.getMap(META);
  if (current.formatVersion === undefined)
    meta.set('formatVersion', GAME_FORMAT_VERSION);
  meta.set('kind', kind);
  doc.commit({ origin: 'game-setup' });
  return true;
}

export function readGameLog(doc: LoroDoc): GameLogEntry[] {
  return parseGameLog(doc.getList(LOG).toArray());
}

export function appendGameLog(doc: LoroDoc, entry: GameLogEntry): void {
  doc.getList(LOG).push(encodeGameLogEntry(entry));
  doc.commit({ origin: `game-${entry.t}` });
}

export function readRaceProgress(
  doc: LoroDoc,
  round: number
): Map<string, RacerProgress> {
  const prefix = `${round}:`;
  const progress = new Map<string, RacerProgress>();
  const entries = doc.getMap(RACE_PROGRESS).toJSON() as Record<string, unknown>;
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(prefix)) continue;
    const parsed = parseRacerProgress(value);
    if (parsed) progress.set(key.slice(prefix.length), parsed);
  }
  return progress;
}

export function writeRaceProgress(
  doc: LoroDoc,
  round: number,
  userId: string,
  progress: RacerProgress
): void {
  doc
    .getMap(RACE_PROGRESS)
    .set(raceProgressKey(round, userId), JSON.stringify(progress));
  doc.commit({ origin: 'game-race-progress' });
}
