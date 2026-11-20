// Unit tests for the harness itself: the generators are deterministic per
// seed, the comparison sees every fault a mutant plants, and no closure
// swallows those faults.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, sameInstant } from './classify.ts';
import { closureOf } from './closed.ts';
import { compareSnapshots, refCheck, type Snapshot } from './compare.ts';
import { parseRowId } from './dom.ts';
import { generateReads } from './gen.ts';
import { MUTANTS } from './mutants.ts';
import { instant, project, sameRows } from './project.ts';
import { Rng } from './rng.ts';
import { buildWorld } from './world.ts';

const snap = (entities: Record<string, unknown>[]): Snapshot => ({
  transport: 'graphql',
  error: null,
  pages: 1,
  hasNextPage: false,
  entities,
  groups: null,
  itemsById: null,
});

const doc = (id: string, notifiedAt: string, extra: Record<string, unknown> = {}) => ({
  type: 'document',
  id,
  name: `Doc ${id}`,
  notifiedAt,
  ...extra,
});

const base = [
  doc('a', '2026-11-20T10:00:00.000Z'),
  doc('b', '2026-11-20T09:00:00.000Z'),
  doc('c', '2026-11-20T08:00:00.000Z'),
  doc('d', '2026-11-20T07:00:00.000Z'),
];

const open = (oldEntities: Record<string, unknown>[], newEntities: Record<string, unknown>[]) =>
  compareSnapshots(snap(oldEntities), snap(newEntities))
    .map(classify)
    .filter((d) => !closureOf(d.cls))
    .map((d) => d.cls);

describe('rng and generators', () => {
  it('draw the same sequence for the same seed', () => {
    const a = new Rng(1101);
    const b = new Rng(1101);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
    expect(new Rng(1102).next()).not.toEqual(new Rng(1101).next());
  });

  it('generate the same read cases from the same seed, across every source', () => {
    const world = buildWorld({ seed: 1101, lanes: 3, sizes: [0, 1, 101], outDir: mkdtempSync(join(tmpdir(), 'nsort-world-')) });
    const now = Date.parse("2026-11-20T12:00:00Z");
    const first = generateReads(world, new Rng(7), 400, 0, now);
    const again = generateReads(world, new Rng(7), 400, 0, now);
    expect(again).toEqual(first);
    const sources = new Set(first.map((c) => c.dims.source));
    expect([...sources].sort()).toEqual(['filter', 'home', 'preset']);
    expect(new Set(first.map((c) => c.dims.grouped)).size).toBeGreaterThan(1);
  });
});

describe('comparison', () => {
  it('reports nothing for equal reads', () => {
    expect(open(base, structuredClone(base))).toEqual([]);
  });

  it('catches a dropped row, a swapped pair and an altered notification time', () => {
    expect(open(base, base.filter((_, i) => i !== 2))).toEqual(['membership:missing-in-new:document']);
    expect(open(base, [base[1], base[0], ...base.slice(2)])).toEqual(['order']);
    const shifted = base.map((d, i) => (i === 1 ? { ...d, notifiedAt: '2026-11-20T08:59:00.000Z' } : d));
    expect(open(base, shifted)).toEqual(['field:document.notifiedAt']);
  });

  it('treats the same instant in two spellings as one value, down to the microsecond', () => {
    expect(sameInstant('2026-11-20T10:00:00.123456Z', '2026-11-20T10:00:00.123456+00:00')).toBe(true);
    expect(sameInstant('2026-11-20T10:00:00.123456Z', '2026-11-20T10:00:00.123457+00:00')).toBe(false);
    expect(instant('2026-11-20T10:00:00.5+00:00')).toBe('2026-11-20T10:00:00.500000000Z');
  });

  it('asks the reference read whether a field difference is the transport mapping', () => {
    const oldSnap = snap([doc('a', '2026-11-20T10:00:00.000Z', { deletedAt: null })]);
    const newSnap = snap([doc('a', '2026-11-20T10:00:00.000Z', {})]);
    const diffs = compareSnapshots(oldSnap, newSnap);
    expect(refCheck(newSnap, snap([doc('a', '2026-11-20T10:00:00.000Z', {})]), diffs, sameInstant)).toEqual(['ref-agrees']);
    expect(refCheck(newSnap, snap([doc('a', '2026-11-20T10:00:00.000Z', { deletedAt: null })]), diffs, sameInstant)).toEqual(['ref-disagrees']);
    expect(refCheck(newSnap, snap([]), diffs, sameInstant)).toEqual(['ref-absent']);
  });

  it('projects a list to rows, order and notification time', () => {
    const a = project(snap(base));
    expect(sameRows(a, project(snap(structuredClone(base))))).toBe(true);
    expect(sameRows(a, project(snap([base[1], base[0], base[2], base[3]])))).toBe(false);
  });

  it('reads the entity of a Home row from its DOM id', () => {
    expect(parseRowId('s8:soup-row|s6:entity|s10:initiative|s36:5eed724e-56f5-88ba-92da-741c6af805b6|s5:today|u')).toEqual({
      type: 'initiative',
      id: '5eed724e-56f5-88ba-92da-741c6af805b6',
      bucket: 'today',
    });
    expect(parseRowId('s8:soup-row|s12:group-header|s5:today')).toBeNull();
  });
});

describe('closures', () => {
  it('never explain a class a mutant produces', () => {
    for (const cls of ['order', 'membership:missing-in-new:document', 'membership:extra-in-new:channel', 'field:document.notifiedAt', 'field:channel.notifiedAt', 'paging:hasNextPage', 'groups[].label', 'live:home:new-not-within-bound', 'raw spec0 order', 'seq home touch signal dom:row-id']) {
      expect(closureOf(cls), cls).toBeUndefined();
    }
  });

  it('explain the transport classes wherever a phase label puts them', () => {
    expect(closureOf('reload spec2 field:document.deletedAt')?.id).toBe('T2');
    expect(closureOf('same-instant:raw spec1 field:email.sortTs')?.id).toBe('C1');
  });
});

describe('mutants', () => {
  it('each match exactly one place at the branch head', () => {
    const repo = join(import.meta.dirname, '../../..');
    for (const mutant of MUTANTS) {
      const text = readFileSync(join(repo, mutant.file), 'utf8');
      expect(text.split(mutant.find).length - 1, mutant.name).toBe(1);
    }
  });
});
