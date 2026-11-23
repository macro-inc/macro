// Unit tests for the harness itself: the generators are deterministic per
// seed, the comparison sees every fault a mutant plants, and no closure
// swallows those faults.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classify, sameInstant } from './classify.ts';
import { closureOf } from './closed.ts';
import { authRefreshTimeoutClass, compareSnapshots, refCheck, type Snapshot } from './compare.ts';
import { channelNameRest, heldApartFromShared, homeCheckClosure, onlyStaleTimeLabels, withoutChannelNameSnapshots, withoutDayRollover } from './dom-held.ts';
import { compareHomeDom, parseRowId } from './dom.ts';
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

  it("compares a channel's participants as a set, naming another order apart from another member", () => {
    const channel = (participantIds: string[], name = 'c') => ({ type: 'channel', id: 'c1', name, notifiedAt: '2026-11-20T09:00:00.000Z', participantIds });
    const open = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareSnapshots(snap([a]), snap([b]), { label: 'raw spec0' })
        .map(classify)
        .filter((d) => !closureOf(d.cls))
        .map((d) => d.cls);
    const sigs = (a: Record<string, unknown>, b: Record<string, unknown>) =>
      compareSnapshots(snap([a]), snap([b]), { label: 'raw spec0' }).map((d) => d.signature);
    expect(sigs(channel(['u1', 'u2', 'u3']), channel(['u3', 'u1', 'u2']))).toEqual(['raw spec0 field-order:channel.participantIds']);
    expect(open(channel(['u1', 'u2', 'u3']), channel(['u3', 'u1', 'u2']))).toEqual([]);
    expect(sigs(channel(['u1', 'u2']), channel(['u1', 'u2']))).toEqual([]);
    // Another member, a missing one, or another field beside a reorder stays open.
    expect(open(channel(['u1', 'u2']), channel(['u1', 'u9']))).toEqual(['raw spec0 field:channel.participantIds[]']);
    expect(open(channel(['u1', 'u2']), channel(['u2']))).toContain('raw spec0 field:channel.participantIds.length');
    expect(open(channel(['u1', 'u2']), channel(['u2', 'u1'], 'd'))).toEqual(['raw spec0 field:channel.name']);
    // Only a channel's participants: another entity's array order still counts.
    const reordered = (ids: string[]) => ({ ...doc('a', '2026-11-20T09:00:00.000Z'), participantIds: ids });
    expect(open(reordered(['u1', 'u2']), reordered(['u2', 'u1']))).toEqual(['raw spec0 field:document.participantIds[]', 'raw spec0 field:document.participantIds[]']);
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

  it('names a session refresh that gave up, on either side, and nothing else', () => {
    const failed = (error: string, transport = 'rest'): Snapshot => ({ ...snap([]), error, transport });
    const sigs = (a: Snapshot, b: Snapshot) => compareSnapshots(a, b, { label: 'reload spec0' }).map((d) => d.signature);
    expect(sigs(failed('Authentication refresh timed out'), snap(base))).toEqual(['reload spec0 error:old:auth-refresh-timeout']);
    expect(sigs(snap(base), failed('Authentication refresh timed out', 'graphql'))).toEqual(['reload spec0 error:new:auth-refresh-timeout']);
    expect(sigs(failed('Authentication refresh cancelled'), snap(base))).toEqual(['reload spec0 error:old']);
    expect(closureOf('reload spec0 error:old:auth-refresh-timeout')?.id).toBe('T10');
    expect(authRefreshTimeoutClass('reload spec0 error:old', ['old=Authentication refresh timed out new=null'])).toBe('reload spec0 error:old:auth-refresh-timeout');
    expect(authRefreshTimeoutClass('reload spec0 error:old', ['old=Network error occurred new=null'])).toBe('reload spec0 error:old');
    expect(authRefreshTimeoutClass('reload spec0 error:old', [])).toBe('reload spec0 error:old');
    expect(authRefreshTimeoutClass('reload spec0 field:x', ['old=Authentication refresh timed out new=null'])).toBe('reload spec0 field:x');
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

describe('withoutDayRollover', () => {
  const r = (type: string, id: string, bucket: string, text: string) => `${type}/${id}/${bucket}/u ${text}`;
  const mountedOld = ['# Today', r('channel', 'a', 'today', 'A7m'), r('document', 'b', 'today', 'B1h'), '# Older', r('project', 'p', 'older', 'P3w')];
  const mountedNew = ['# Today', r('calendar_event', 'c', 'today', 'C1m'), r('channel', 'a', 'today', 'A7m'), r('document', 'b', 'today', 'B1h'), '# Older', r('project', 'p', 'older', 'P3w')];
  const reload = ['# Yesterday', r('calendar_event', 'c', 'yesterday', 'C1m'), r('channel', 'a', 'yesterday', 'A7m'), r('document', 'b', 'yesterday', 'B1h'), '# Older', r('project', 'p', 'older', 'P3w')];
  it('sets the date buckets aside when both mounted Homes kept Today and both reloads moved it to Yesterday', () => {
    const e = { oldMounted: mountedOld, newMounted: mountedNew, oldReload: reload, newReload: reload };
    expect(withoutDayRollover(e).newMounted).toEqual(withoutDayRollover(e).newReload);
    expect(heldApartFromShared(e)).toMatchObject({ newHeld: true, oldHeld: false });
    expect(homeCheckClosure(e, ['seq home touch signal dom:row-id'])?.suffix).toBe('dom:old-behind-reload');
  });
  it('keeps order and text', () => {
    const swapped = [mountedNew[0], mountedNew[2], mountedNew[1], ...mountedNew.slice(3)];
    expect(heldApartFromShared({ oldMounted: mountedOld, newMounted: swapped, oldReload: reload, newReload: reload }).newHeld).toBe(false);
    const renamed = mountedNew.map((row) => row.replace('B1h', 'Renamed1h'));
    expect(heldApartFromShared({ oldMounted: mountedOld, newMounted: renamed, oldReload: reload, newReload: reload }).newHeld).toBe(false);
  });
  it('leaves the buckets alone when no day rolled over', () => {
    const e = { oldMounted: mountedOld, newMounted: mountedNew, oldReload: mountedNew, newReload: mountedNew };
    expect(withoutDayRollover(e)).toBe(e);
    const one = { oldMounted: mountedOld, newMounted: reload, oldReload: reload, newReload: reload };
    expect(withoutDayRollover(one)).toBe(one);
  });
});

describe('channel names', () => {
  const thread = (id: string, text: string) => ({ kind: 'entity' as const, id: `s8:soup-row|s6:entity|s14:channel_thread|s1:${id}|s5:today|u`, text, unread: false, labels: [] });
  const doc = (id: string, text: string) => ({ kind: 'entity' as const, id: `s8:soup-row|s6:entity|s8:document|s1:${id}|s5:today|u`, text, unread: false, labels: [] });
  it('sees a snapshot name against another name in front of the same rest', () => {
    expect(channelNameRest('v2-privYou:root 1B Seed:a reply<t:m>', 'priv 996You:root 1B Seed:a reply<t:m>')).toBe('You:root 1B Seed:a reply<t:m>');
    expect(channelNameRest('team-3501You:hi', 'tchYou:hi')).toBe('You:hi');
    expect(channelNameRest('priv 996You:root 1', 'priv 997You:root 1')).toBeNull();
    expect(channelNameRest('v2-privYou:root 1', 'priv 996You:root 2')).toBeNull();
    expect(channelNameRest('v2-privYou:root 1', 'v2-privYou:root 1')).toBeNull();
  });
  it('sets the name aside and still compares the rows after it', async () => {
    const old = [thread('a', 'v2-privYou:root<t:m>'), doc('d', 'Doc<t:m>')];
    const same = await compareHomeDom(undefined as never, undefined as never, old, [thread('a', 'priv 996You:root<t:m>'), doc('d', 'Doc<t:m>')], 'home');
    expect(same.map((d) => d.signature)).toEqual(['home dom:channel-name-snapshot']);
    expect(closureOf('home dom:channel-name-snapshot')?.id).toBe('N1');
    const apart = await compareHomeDom(undefined as never, undefined as never, old, [thread('a', 'priv 996You:root<t:m>'), doc('d', 'Other<t:m>')], 'home');
    expect(apart.map((d) => d.signature)).toEqual(['home dom:channel-name-snapshot', 'home dom:text']);
    const renamed = await compareHomeDom(undefined as never, undefined as never, [thread('a', 'priv 1You:root<t:m>')], [thread('a', 'priv 2You:root<t:m>')], 'home');
    expect(renamed.map((d) => d.signature)).toEqual(['home dom:text']);
  });
  it('rewrites recorded rows only where a thread shows exactly a snapshot and one other name', () => {
    const t = (name: string, label = '3h') => `channel_thread/a/today/u ${name}You:root${label}`;
    const e = { oldMounted: [t('priv 4')], newMounted: [t('priv 4', '4h')], oldReload: [t('v4-priv')], newReload: [t('v4-priv')] };
    expect(withoutChannelNameSnapshots(e).oldReload).toEqual(['channel_thread/a/today/u <channel>You:root3h']);
    expect(withoutChannelNameSnapshots(e).newMounted).toEqual(['channel_thread/a/today/u <channel>You:root4h']);
    const three = { ...e, newMounted: [t('priv 5')] };
    expect(withoutChannelNameSnapshots(three)).toBe(three);
  });
  it('closes a Home check apart only in a thread name', () => {
    const t = (name: string) => `channel_thread/a/today/u ${name}You:root3h`;
    const d = 'document/d/today/u Doc3h';
    const e = { oldMounted: ['# Today', t('v2-priv'), d], newMounted: ['# Today', t('priv 9'), d], oldReload: ['# Today', t('priv 9'), d], newReload: ['# Today', t('priv 9'), d] };
    expect(homeCheckClosure(e, ['seq home touch signal dom:text'])?.suffix).toBe('dom:channel-name-snapshot');
    expect(homeCheckClosure({ ...e, newMounted: ['# Today', t('priv 9'), 'document/d/today/u Other3h'] }, ['seq home touch signal dom:text'])?.suffix).not.toBe('dom:channel-name-snapshot');
  });
});

describe('fixed closures', () => {
  it('explain nothing once the PR fixed them', () => {
    expect(closureOf('seq home touch signal dom:stale-mail-label')).toBeUndefined();
    expect(closureOf('seq home touch signal dom:stale-time-label')?.id).toBe('L1');
  });
});
