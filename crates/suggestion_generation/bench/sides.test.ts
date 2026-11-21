import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixKeys, unnamed } from './heldout';
import { type Persona, keyDigest, unnamedPersona, who } from './personas';
import type { Generation } from './run';
import type { Attempt, RunFile } from './score';
import { comparable, joinRuns, sameBuild, staleKeys, unrecordedKeys } from './sides';

const attempt = (persona: string, rep: number, heldout = false): Attempt => ({
  section: 'routines',
  label: 't',
  persona,
  heldout,
  rep,
  generation: { routines: [] } as unknown as Generation,
  judgeUsd: 0,
});

const run = (over: Partial<RunFile> = {}): RunFile => ({
  section: 'routines',
  label: 'main',
  commit: 'abc',
  set: 'm',
  startedAt: '',
  instance: 'i',
  concurrency: 1,
  judge: 'judge v5',
  personas: { ana: 'pa', bo: 'pb' },
  keys: { ana: 'ka', bo: 'kb' },
  flags: { 'enable-routine-suggestions': true },
  attempts: [attempt('ana', 1), attempt('bo', 1)],
  ...over,
});

describe('one side of a comparison', () => {
  test('joins runs of one build, reps following on', () => {
    const side = joinRuns('a,b', [run({ label: 'a' }), run({ label: 'b' })]);
    expect(side.label).toBe('a+b');
    expect(side.commit).toBe('abc');
    expect(side.attempts.map((a) => a.rep)).toEqual([1, 1, 2, 2]);
    expect(side.keys).toEqual({ ana: 'ka', bo: 'kb' });
  });

  test('is one build: refuses runs of two commits or two sets of flags', () => {
    expect(() => joinRuns('a,b', [run(), run({ commit: 'def' })])).toThrow('mixes commits');
    expect(() => joinRuns('a,b', [run(), run({ flags: { 'enable-routine-suggestions': true, 'routine-suggestions-find-work': true } })])).toThrow('mixes flags');
    // A flag turned off is no flag.
    expect(joinRuns('a,b', [run(), run({ flags: { 'enable-routine-suggestions': true, other: false } })]).attempts).toHaveLength(4);
  });

  test('joins no runs of an unknown build: no commit, or no flags, recorded', () => {
    expect(() => joinRuns('a,b', [run({ commit: 'unknown' }), run({ commit: 'unknown' })])).toThrow('no commit recorded');
    expect(() => joinRuns('a,b', [run({ flags: undefined }), run({ flags: undefined })])).toThrow('no flags recorded');
    // One run is its own side, whatever it recorded.
    expect(joinRuns('a', [run({ commit: 'unknown', flags: undefined })]).attempts).toHaveLength(2);
  });

  test('refuses runs scored against different answer keys, or one without them', () => {
    expect(() => joinRuns('a,b', [run(), run({ keys: { ana: 'changed', bo: 'kb' } })])).toThrow("different answer keys for ana");
    expect(() => joinRuns('a,b', [run(), run({ keys: undefined })])).toThrow('rejudge it');
    // A held-out run without keys can't be rejudged: it is run again.
    const held = (over: Partial<RunFile>) => run({ attempts: [attempt('ana', 1, true), attempt('bo', 1, true)], ...over });
    expect(() => joinRuns('a,b', [held({}), held({ keys: undefined })])).toThrow('run it again');
    expect(() => comparable(held({}), held({ keys: undefined }))).toThrow('run it again');
    // Judged by another judge too, it is still run again: rejudging it is refused.
    expect(() => comparable(held({}), held({ keys: undefined, judge: 'judge v4' }))).toThrow('run it again');
    expect(() => comparable(run(), run({ judge: 'judge v4' }))).toThrow('different judges');
  });

  test('never names a held-out person', () => {
    const held = (over: Partial<RunFile>) => run({ attempts: [attempt('ana', 1, true), attempt('bo', 1, true)], ...over });
    for (const bad of [{ keys: { ana: 'changed', bo: 'kb' } }, { personas: { ana: 'changed', bo: 'pb' } }]) {
      let message = '';
      try {
        joinRuns('a,b', [held({}), held(bad)]);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('a held-out person');
      expect(message).not.toContain('ana');
    }
  });
});

describe('two sides set side by side', () => {
  test('need one judge and the same answer keys', () => {
    expect(() => comparable(run(), run({ label: 'cand' }))).not.toThrow();
    expect(() => comparable(run(), run({ label: 'cand', judge: 'judge v4' }))).toThrow('different judges');
    expect(() => comparable(run(), run({ label: 'cand', keys: { ana: 'ka', bo: 'changed' } }))).toThrow('different answer keys for bo');
    expect(() => comparable(run({ keys: undefined }), run({ label: 'cand' }))).toThrow('main has no digest of ana');
  });

  test('measure noise only on one build: the same known commit and flags', () => {
    expect(() => sameBuild(run(), run({ label: 'again' }))).not.toThrow();
    expect(() => sameBuild(run(), run({ label: 'cand', commit: 'def' }))).toThrow('one build against itself');
    expect(() => sameBuild(run(), run({ label: 'cand', flags: { 'routine-suggestions-find-work': true } }))).toThrow('different flags');
    expect(() => sameBuild(run({ commit: 'unknown' }), run({ commit: 'unknown' }))).toThrow('no commit recorded');
    expect(() => sameBuild(run({ flags: undefined }), run({ flags: undefined }))).toThrow('no flags recorded');
  });
});

describe("a held-out set's answer keys", () => {
  const person = (key: string): Persona =>
    ({ name: 'ana', seat: 1, heldout: true, dir: '', workspace: {}, inbox: {}, routinesTruth: { needs: [{ id: 'r1', what: key }], decoys: [], misfit: [], fine: [] } }) as unknown as Persona;

  test('digest every key a person is scored against', () => {
    expect(keyDigest(person('a'))).toBe(keyDigest(person('a')));
    expect(keyDigest(person('a'))).not.toBe(keyDigest(person('b')));
    expect(who(person('a'))).toBe('a held-out person');
    expect(who({ name: 'ana', heldout: false })).toBe('ana');
  });

  test('are fixed by the first use of each person, and a changed one is refused without naming them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'));
    try {
      mkdirSync(join(dir, 'set'));
      fixKeys('set', { ana: 'ka' }, dir);
      expect(JSON.parse(readFileSync(join(dir, 'set', 'keys.json'), 'utf8')).keys).toEqual({ ana: 'ka' });
      // The same keys again, and a person first scored now, are fine; the newcomer is fixed too.
      fixKeys('set', { ana: 'ka', bo: 'kb' }, dir);
      expect(JSON.parse(readFileSync(join(dir, 'set', 'keys.json'), 'utf8')).keys).toEqual({ ana: 'ka', bo: 'kb' });
      let message = '';
      try {
        fixKeys('set', { ana: 'ka', bo: 'changed' }, dir);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain('1 of 2 people of held-out set set have answer keys other than');
      expect(message).not.toContain('bo');
      expect(existsSync(join(dir, 'set', 'keys.json.partial'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('are written by one command at a time, and never past a lock another holds', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-'));
    try {
      mkdirSync(join(dir, 'set'));
      const lock = join(dir, 'set', 'keys.json.lock');
      writeFileSync(lock, '');
      expect(() => fixKeys('set', { ana: 'ka' }, dir, 50)).toThrow('held by another bench command');
      expect(existsSync(join(dir, 'set', 'keys.json'))).toBe(false);
      // However old: only its holder, or a person, removes it.
      expect(existsSync(lock)).toBe(true);
      unlinkSync(lock);
      fixKeys('set', { ana: 'ka' }, dir, 50);
      fixKeys('set', { bo: 'kb' }, dir, 50);
      expect(JSON.parse(readFileSync(join(dir, 'set', 'keys.json'), 'utf8')).keys).toEqual({ ana: 'ka', bo: 'kb' });
      // Nothing left beside the keys: no lock, no partial copy.
      expect(readdirSync(join(dir, 'set'))).toEqual(['keys.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('a rescore', () => {
  const persona = (name: string) => ({ name }) as Persona;

  test('keeps marks judged against the keys as they are now', () => {
    expect(staleKeys(run({ keys: { ana: 'ka', bo: 'kb' } }), [persona('ana'), persona('bo')], { ana: 'ka', bo: 'kb' })).toBe(0);
  });

  test('refuses marks judged against other keys than the ones it would score against', () => {
    expect(staleKeys(run({ keys: { ana: 'ka', bo: 'kb' } }), [persona('ana'), persona('bo')], { ana: 'ka', bo: 'changed' })).toBe(1);
  });

  test('never judges again a held-out run that recorded no keys for its people', () => {
    const held = (name: string) => ({ name, heldout: true }) as Persona;
    expect(unrecordedKeys(run({ keys: undefined }), [held('ana'), persona('bo')])).toBe(1);
    expect(unrecordedKeys(run({ keys: { ana: 'ka' } }), [held('ana'), held('bo')])).toBe(1);
    expect(unrecordedKeys(run({ keys: { ana: 'ka', bo: 'kb' } }), [held('ana'), held('bo')])).toBe(0);
    // A name that is an inherited property is no key.
    expect(unrecordedKeys(run({ keys: {} }), [held('constructor')])).toBe(1);
  });

  test("refuses a run that can't show which keys its marks were judged against", () => {
    expect(staleKeys(run({ keys: undefined }), [persona('ana'), persona('bo')], { ana: 'ka', bo: 'kb' })).toBe(2);
    expect(staleKeys(run({ keys: { ana: 'ka' } }), [persona('ana'), persona('bo')], { ana: 'ka', bo: 'kb' })).toBe(1);
  });
});

describe('a held-out writer', () => {
  test("cuts a person's slug, names and domain out of an error", () => {
    const sketch = { mail: 'month' as const, slug: 'larkin', persona: '', owner_first: 'Ines', owner_last: 'Larkin', domain: 'larkin-tile.example', timezone: 'UTC', labels: [], colleagues: [{ first: 'Bo', last: 'Price', role: '' }], situation: '', volume: 0 };
    expect(unnamed(sketch, 'larkin: ines@larkin-tile.example wrote to bo@larkin-tile.example (Bo Price)')).toBe('…: …@… wrote to …@… (… …)');
  });
});

describe("a held-out person's errors", () => {
  const persona = (heldout: boolean): Persona =>
    ({
      name: 'larkin',
      heldout,
      inbox: { owner: { name: 'Ines Larkin', email: 'ines@larkin-tile.example' } },
      workspace: { users: { ines: { email: 'ines@larkin-tile.example', name: 'Ines Larkin' }, bo: { email: 'bo.price@larkin-tile.example', name: 'Bo Price' } } },
    }) as unknown as Persona;

  test("carry none of their names, addresses or scenario's name", () => {
    const text = 'seed-scenario apply sugbench-h-larkin exited 1; macro|ines@larkin-tile.example still has sessions open; bo.price wrote (Bo Price)';
    expect(unnamedPersona(persona(true), text)).toBe('seed-scenario apply sugbench-h-… exited 1; macro|… still has sessions open; … wrote (… …)');
    expect(unnamedPersona(persona(false), text)).toBe(text);
  });
});
