import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, it } from 'vitest';
import {
  appendGameLog,
  ensureGameMeta,
  GAME_FORMAT_VERSION,
  readGameLog,
  readGameMeta,
  readRaceProgress,
  writeRaceProgress,
} from './game-document';
import { connectFourRules } from './games/connect-four';
import { replayTurnMatch } from './turn-match';

/** The repository's shared static assets, from whichever directory runs vitest. */
function staticAsset(name: string): Buffer {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'static_assets', name))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`static asset ${name} not found`);
    dir = parent;
  }
  return readFileSync(join(dir, 'static_assets', name));
}

function sync(a: LoroDoc, b: LoroDoc) {
  a.import(b.export({ mode: 'update', from: a.version() }));
  b.import(a.export({ mode: 'update', from: b.version() }));
}

describe('game document', () => {
  it('matches the seed the backend gives every new room', () => {
    const doc = new LoroDoc();
    doc.import(staticAsset('game-golden.1.bin'));
    expect(doc.toJSON()).toEqual({
      gameMeta: { formatVersion: GAME_FORMAT_VERSION },
    });
    expect(ensureGameMeta(doc, 'snake')).toBe(true);
    expect(readGameMeta(doc).kind).toBe('snake');
  });

  it('records the game kind once', () => {
    const doc = new LoroDoc();
    expect(readGameMeta(doc)).toEqual({
      kind: undefined,
      formatVersion: undefined,
    });
    expect(ensureGameMeta(doc, 'connect_four')).toBe(true);
    expect(ensureGameMeta(doc, 'snake')).toBe(false);
    expect(readGameMeta(doc)).toEqual({
      kind: 'connect_four',
      formatVersion: GAME_FORMAT_VERSION,
    });
  });

  it('skips malformed log entries written by other clients', () => {
    const doc = new LoroDoc();
    appendGameLog(doc, { t: 'join', by: 'ann' });
    doc.getList('gameLog').push('{"t":"join"}');
    doc.getList('gameLog').push('not json');
    doc.getList('gameLog').push('{"t":"teleport","by":"bob"}');
    doc.commit();
    expect(readGameLog(doc)).toEqual([{ t: 'join', by: 'ann' }]);
  });

  it('keeps one move when a player moves from two devices at once', () => {
    const laptop = new LoroDoc();
    laptop.setPeerId(1n);
    ensureGameMeta(laptop, 'connect_four');
    appendGameLog(laptop, { t: 'join', by: 'ann' });
    appendGameLog(laptop, { t: 'join', by: 'bob' });
    const phone = new LoroDoc();
    phone.setPeerId(2n);
    sync(laptop, phone);

    appendGameLog(laptop, { t: 'move', by: 'ann', move: { column: 0 } });
    appendGameLog(phone, { t: 'move', by: 'ann', move: { column: 6 } });
    sync(laptop, phone);

    const fromLaptop = replayTurnMatch(connectFourRules, readGameLog(laptop));
    const fromPhone = replayTurnMatch(connectFourRules, readGameLog(phone));
    expect(fromLaptop).toEqual(fromPhone);
    if (fromLaptop.phase.t !== 'playing') throw new Error('expected play');
    expect(fromLaptop.phase.state.columns.flat()).toEqual([0]);
    expect(fromLaptop.phase.turn).toBe(1);
  });

  it('stores race progress per round and racer', () => {
    const doc = new LoroDoc();
    writeRaceProgress(doc, 0, 'ann', { typed: 10, mistakes: 1 });
    writeRaceProgress(doc, 1, 'ann', { typed: 4, mistakes: 0 });
    writeRaceProgress(doc, 1, 'macro|bob@example.com', {
      typed: 7,
      mistakes: 0,
      finishedMs: 30_000,
      wpm: 64,
    });
    expect(readRaceProgress(doc, 1)).toEqual(
      new Map([
        ['ann', { typed: 4, mistakes: 0 }],
        [
          'macro|bob@example.com',
          { typed: 7, mistakes: 0, finishedMs: 30_000, wpm: 64 },
        ],
      ])
    );
  });
});
