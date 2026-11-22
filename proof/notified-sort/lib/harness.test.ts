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
import { heldApartFromShared, homeCheckClosure, onlyStaleTimeLabels } from './dom-held.ts';
import { parseRowId } from './dom.ts';
import { generateReads } from './gen.ts';
import { MUTANTS } from './mutants.ts';
import { discrepancies, instant, project, sameRows } from './project.ts';
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

  it('compares only the shared prefix when main kept pages from an earlier read, and still catches faults in it', () => {
    const paged = (entities: Record<string, unknown>[], pages: number): Snapshot => ({ ...snap(entities), pages, hasNextPage: true });
    const rows = [...base, doc('e', '2026-11-20T06:00:00.000Z'), doc('f', '2026-11-20T05:00:00.000Z')];
    const openPaged = (newRows: Record<string, unknown>[], pages = 2) =>
      compareSnapshots(paged(rows, 2), paged(newRows, pages), { pageSize: 2 })
        .map(classify)
        .filter((d) => !closureOf(d.cls))
        .map((d) => d.cls);
    expect(openPaged(rows.slice(0, 4))).toEqual([]);
    expect(compareSnapshots(paged(rows, 2), paged(rows.slice(0, 4), 2), { pageSize: 2 }).map((d) => d.signature)).toEqual(['paging:retained-pages']);
    // The last row dropped: no longer full pages.
    expect(openPaged(rows.slice(0, 3))).toContain('membership:missing-in-new:document');
    // A row dropped inside: the prefix breaks.
    expect(openPaged([rows[0], rows[1], rows[2], rows[4]])).toContain('membership:missing-in-new:document');
    expect(openPaged([rows[1], rows[0], rows[2], rows[3]])).toContain('order');
    const altered = rows.slice(0, 4).map((d, i) => (i === 3 ? { ...d, notifiedAt: '2026-11-20T08:59:00.000Z' } : d));
    expect(openPaged(altered)).toEqual(['field:document.notifiedAt']);
    // Main read past its kept pages to the end of the list (no next page)
    // while the branch stopped at the limit: still only the kept tail.
    const ended = { ...paged(rows, 2), hasNextPage: false };
    expect(compareSnapshots(ended, paged(rows.slice(0, 4), 2), { pageSize: 2 }).map((d) => d.signature)).toEqual(['paging:retained-pages']);
    expect(compareSnapshots(ended, paged([rows[0], rows[1], rows[2], rows[4]], 2), { pageSize: 2 }).map((d) => d.signature)).toContain('paging:hasNextPage');
    // The branch at the end of the list with fewer rows is not this case.
    expect(compareSnapshots(ended, { ...paged(rows.slice(0, 4), 2), hasNextPage: false }, { pageSize: 2 }).map((d) => d.signature)).toContain(
      'membership:missing-in-new:document'
    );
  });

  it("names main's request deadline apart from every other error, and compares no rows past an error", () => {
    const failed = (error: string, transport = 'rest'): Snapshot => ({ ...snap([]), error, transport });
    const sigs = (a: Snapshot, b: Snapshot) => compareSnapshots(a, b, { label: 'reload spec0' }).map((d) => d.signature);
    expect(sigs(failed('An unknown error occurred: TimeoutError: signal timed out'), snap(base))).toEqual(['reload spec0 error:old:deadline']);
    expect(sigs(failed('An unknown error occurred: AbortError: The user aborted a request.'), snap(base))).toEqual(['reload spec0 error:old:deadline']);
    expect(sigs(failed('Network error occurred'), snap(base))).toEqual(['reload spec0 error:old']);
    // Only main's REST reader has the deadline; the branch erroring stays open.
    expect(sigs(snap(base), failed('TimeoutError: signal timed out', 'graphql'))).toEqual(['reload spec0 error:new']);
    expect(closureOf('reload spec0 error:old:deadline')?.id).toBe('T9');
    for (const open of ['reload spec0 error:old', 'raw spec1 error:new', 'reload spec0 error:new:deadline']) expect(closureOf(open), open).toBeUndefined();
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

describe('live closures', () => {
  it('close main falling behind and both sides behind alike, never the branch alone', () => {
    expect(closureOf('live:random:old-behind:notify/calendar')?.id).toBe('B1');
    expect(closureOf('live:home:old-behind:rename/task')?.id).toBe('B1');
    expect(closureOf('seq home touch signal dom:old-behind-reload')?.id).toBe('B1');
    expect(closureOf('live:grouped:both-stale-alike:done/document')?.id).toBe('S1');
    expect(closureOf('live:grouped:new-held-notified-stamp')?.id).toBe('H1');
    for (const open of [
      'live:random:new-not-within-bound',
      'live:home:new-held-notified-stamp',
      'live:home:new-not-within-bound:after-network-change',
      'live:home:old-behind:done/document:after-network-change',
      'live:random:both-not-within-bound',
      'live:random:fresh-reads-differ',
      'live:home:new-unsettled',
      'live:home:old-unread',
      'seq home touch signal dom:row-id',
    ]) {
      expect(closureOf(open), open).toBeUndefined();
    }
  });

  it('name each way a mounted list parts from its read', () => {
    const row = (key: string, notifiedAt = 't1', name = key) => ({ key, notifiedAt, name });
    const fresh = [row('a'), row('b'), row('c')];
    expect(discrepancies(fresh, fresh)).toEqual([]);
    expect(discrepancies([row('x'), ...fresh], fresh)).toEqual(['extra:x']);
    expect(discrepancies(fresh.slice(1), fresh)).toEqual(['missing:a']);
    expect(discrepancies([fresh[1], fresh[0], fresh[2]], fresh)).toEqual(['order']);
    expect(discrepancies([row('a', 't0'), row('b', 't1', 'old'), row('c')], fresh)).toEqual(['notifiedAt:a', 'name:b']);
  });
});

describe('heldApartFromShared', () => {
  const base = { header: '# Today', a: 'document/a/today/u Doc A 3m', b: 'channel/b/today/u Chan B 3m', c: 'email/c/today/u Mail C 3m' };
  it('sets aside a row both mounted sides kept alike, so main alone lagging shows', () => {
    const e = {
      oldMounted: [base.header, base.a, base.b, 'email/c/today/u Old name 3m'],
      newMounted: [base.header, base.a, base.b, 'email/c/today/u New name 4m'],
      oldReload: [base.header, base.a, 'email/c/today/u New name 4m'],
      newReload: [base.header, base.a, 'email/c/today/u New name 4m'],
    };
    expect(heldApartFromShared(e)).toEqual({ newHeld: true, oldHeld: false, shared: ['channel/b'] });
  });
  it('keeps the branch not held when it misses a row main shows', () => {
    const e = { oldMounted: [base.header, base.a, base.c], newMounted: [base.header, base.a], oldReload: [base.header, base.a, base.c], newReload: [base.header, base.a, base.c] };
    expect(heldApartFromShared(e).newHeld).toBe(false);
  });
  it('keeps the branch not held when its text differs from both', () => {
    const e = { oldMounted: [base.c], newMounted: ['email/c/today/u Other'], oldReload: ['email/c/today/u New'], newReload: ['email/c/today/u New'] };
    expect(heldApartFromShared(e).newHeld).toBe(false);
  });
});

describe('onlyStaleTimeLabels', () => {
  const row = (id: string, label: string) => `email/${id}/today/u Mail ${id}new mail${label}`;
  const reload = [ '# Today', row('a', '11m'), row('b', '30m'), row('c', '3h') ];
  it('takes mounted sides that differ only in labels no older than their reload', () => {
    const e = { oldMounted: ['# Today', row('a', '5m'), row('b', '24m'), row('c', '3h')], newMounted: ['# Today', row('a', 'now'), row('b', '5m'), row('c', '2h')], oldReload: reload, newReload: reload };
    expect(onlyStaleTimeLabels(e)).toBe(true);
  });
  it('refuses a label older than the reload shows', () => {
    const e = { oldMounted: ['# Today', row('a', '5m'), row('b', '24m'), row('c', '3h')], newMounted: ['# Today', row('a', '40m'), row('b', '24m'), row('c', '3h')], oldReload: reload, newReload: reload };
    expect(onlyStaleTimeLabels(e)).toBe(false);
  });
  it('refuses a row, order or text apart', () => {
    const base = ['# Today', row('a', '5m'), row('b', '24m'), row('c', '3h')];
    expect(onlyStaleTimeLabels({ oldMounted: base, newMounted: [base[0], base[2], base[1], base[3]], oldReload: reload, newReload: reload })).toBe(false);
    expect(onlyStaleTimeLabels({ oldMounted: base, newMounted: base.slice(0, 3), oldReload: reload, newReload: reload })).toBe(false);
    expect(onlyStaleTimeLabels({ oldMounted: base, newMounted: [base[0], 'email/a/today/u Other name5m', base[2], base[3]], oldReload: reload, newReload: reload })).toBe(false);
    expect(onlyStaleTimeLabels({ oldMounted: base, newMounted: [base[0], row('a', '5m').replace('/u ', '/u* '), base[2], base[3]], oldReload: reload, newReload: reload })).toBe(false);
  });
  it('refuses sides that agree outright', () => {
    const base = ['# Today', row('a', '5m')];
    expect(onlyStaleTimeLabels({ oldMounted: base, newMounted: base, oldReload: reload, newReload: reload })).toBe(false);
  });
});

describe('homeCheckClosure', () => {
  const row = (type: string, id: string, label: string) => `${type}/${id}/today/u Name ${id}${label}`;
  const reload = ['# Today', row('email', 'a', '5h'), row('document', 'd', '5h')];
  it('moves older labels on mail rows only to E1', () => {
    const e = { oldMounted: ['# Today', row('email', 'a', '5h'), row('document', 'd', '5h')], newMounted: ['# Today', row('email', 'a', '3d'), row('document', 'd', '5h')], oldReload: reload, newReload: reload };
    expect(homeCheckClosure(e, ['seq home touch signal dom:text'])?.suffix).toBe('dom:stale-mail-label');
  });
  it('keeps an older label on any other row open', () => {
    const e = { oldMounted: ['# Today', row('email', 'a', '5h'), row('document', 'd', '5h')], newMounted: ['# Today', row('email', 'a', '5h'), row('document', 'd', '3d')], oldReload: reload, newReload: reload };
    expect(homeCheckClosure(e, ['seq home touch signal dom:text'])).toBeNull();
  });
  it('keeps a Home check with a row apart open', () => {
    const e = { oldMounted: ['# Today', row('email', 'a', '5h'), row('document', 'd', '5h')], newMounted: ['# Today', row('email', 'a', '3d')], oldReload: reload, newReload: reload };
    expect(homeCheckClosure(e, ['seq home touch signal dom:row-id'])).toBeNull();
    expect(homeCheckClosure(e, ['seq home touch signal dom:text'])).toBeNull();
  });
});

describe('homeCheckClosure with branch-only initiatives', () => {
  const row = (type: string, id: string, label: string) => `${type}/${id}/today/u Name ${id}${label}`;
  it('sets them aside before judging labels', () => {
    const reload = ['# Today', row('email', 'a', '5h'), row('document', 'd', '5h')];
    const e = {
      oldMounted: reload,
      newMounted: ['# Today', row('initiative', 'i', '2h'), row('email', 'a', '3d'), row('document', 'd', '5h')],
      oldReload: reload,
      newReload: ['# Today', row('initiative', 'i', '2h'), ...reload.slice(1)],
    };
    expect(homeCheckClosure(e, ['seq home touch signal dom:text'])?.suffix).toBe('dom:stale-mail-label');
  });
});

describe('fixed closures', () => {
  it('explain nothing once the PR fixed them', () => {
    expect(closureOf('seq home touch signal dom:stale-mail-label')).toBeUndefined();
    expect(closureOf('seq home touch signal dom:stale-time-label')?.id).toBe('L1');
  });
});
