// Whether a mounted Home already showed what its reload shows, setting aside
// staleness both sides share. Works on the compact rows a step records
// (`checks.domRows`), so report.ts can apply it to runs recorded before it.
//
// A row both mounted Homes show the same way, that both reloads show another
// way (or not at all), is a difference neither side has over the other: main
// and the branch both kept it (the `both-stale-alike` live class, S1). Leaving
// it in made one shared stale row hide that main alone was behind on another.

import type { DomRow } from './compare.ts';

export type CompactDom = { oldMounted: string[]; newMounted: string[]; oldReload: string[]; newReload: string[] };

/** bucket/type:id "text" in screen order; `# label` for a date header. */
export function compactDom(list: DomRow[]): string[] {
  return list.map((r) => (r.kind === 'entity' ? `${r.id.split('|').slice(2).map((p) => p.replace(/^s\d+:/, '')).join('/')}${r.unread ? '*' : ''} ${r.text}` : `# ${r.label}`));
}

/** `type/id/bucket[*] text` → `type/id`; headers have no key. */
const keyOf = (row: string) => (row.startsWith('# ') ? null : row.split(' ')[0].split('/').slice(0, 2).join('/'));
/** One relative-time tick apart is the same read (as lib/dom.ts). */
const norm = (row: string) => row.replace(/(\d+)(m|h|d|w)$/, '<t:$2>');

function rowsByKey(list: string[]): Map<string, string> {
  const by = new Map<string, string>();
  for (const row of list) {
    const k = keyOf(row);
    if (k) by.set(k, norm(row));
  }
  return by;
}

function withoutKeys(list: string[], drop: Set<string>): string[] {
  const kept = list.filter((row) => {
    const k = keyOf(row);
    return k === null || !drop.has(k);
  });
  return kept.filter((row, i) => !row.startsWith('# ') || (kept[i + 1] !== undefined && !kept[i + 1].startsWith('# '))).map(norm);
}

export function heldApartFromShared(e: CompactDom): { newHeld: boolean; oldHeld: boolean; shared: string[] } {
  const om = rowsByKey(e.oldMounted), nm = rowsByKey(e.newMounted), or = rowsByKey(e.oldReload), nr = rowsByKey(e.newReload);
  const keys = new Set([...om.keys(), ...nm.keys(), ...or.keys(), ...nr.keys()]);
  const shared = new Set<string>();
  for (const k of keys) {
    if (om.get(k) === nm.get(k) && or.get(k) === nr.get(k) && om.get(k) !== or.get(k)) shared.add(k);
  }
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  return {
    newHeld: same(withoutKeys(e.newMounted, shared), withoutKeys(e.newReload, shared)),
    oldHeld: same(withoutKeys(e.oldMounted, shared), withoutKeys(e.oldReload, shared)),
    shared: [...shared],
  };
}
