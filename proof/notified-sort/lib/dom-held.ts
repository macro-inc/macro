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

/** `type/id/bucket…` → its bucket. */
const bucketOf = (row: string) => (row.startsWith('# ') ? null : row.split(' ')[0].split('/')[2]?.replace(/\*$/, '') ?? null);

/**
 * The rows with their date buckets and headers dropped when the day rolled
 * over between the mounted read and the reload: Home buckets rows by the
 * viewer's day when it renders them and does not re-bucket a mounted list at
 * midnight, on main as on the branch (both mounted sides keep "Today"). It
 * rolled over when a row both mounted sides show under Today both reloads show
 * under Yesterday, and no reload shows Today. Order and every row's text,
 * time label included, still count.
 */
export function withoutDayRollover(e: CompactDom): CompactDom {
  const today = (rows: string[]) => rows.includes('# Today');
  if (!today(e.oldMounted) || !today(e.newMounted) || today(e.oldReload) || today(e.newReload)) return e;
  const buckets = (rows: string[]) => new Map(rows.flatMap((row) => (keyOf(row) ? [[keyOf(row)!, bucketOf(row)] as const] : [])));
  const [om, nm, or, nr] = [e.oldMounted, e.newMounted, e.oldReload, e.newReload].map(buckets);
  const rolled = [...om].some(([k, b]) => b === 'today' && nm.get(k) === 'today' && or.get(k) === 'yesterday' && nr.get(k) === 'yesterday');
  if (!rolled) return e;
  const strip = (rows: string[]) => rows.filter((row) => !row.startsWith('# ')).map((row) => row.replace(/^([a-z_]+\/[^/ ]+)\/[^/ *]+/, '$1'));
  return { oldMounted: strip(e.oldMounted), newMounted: strip(e.newMounted), oldReload: strip(e.oldReload), newReload: strip(e.newReload) };
}

export function heldApartFromShared(input: CompactDom): { newHeld: boolean; oldHeld: boolean; shared: string[] } {
  const e = withoutDayRollover(input);
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

/** A row's trailing relative-time label (`now`, `5m`, `2h`, `3d`, `1w`, `2mo`, `1y`) and its age in minutes. */
const LABEL = /(now|\d+(?:mo|m|h|d|w|y))$/;
const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 1440, w: 10080, mo: 43200, y: 525600 };
function splitLabel(row: string): { base: string; age: number | null } {
  if (row.startsWith('# ')) return { base: row, age: null };
  const m = LABEL.exec(row);
  if (!m) return { base: row, age: null };
  const label = m[1];
  const unit = label.replace(/^\d+/, '');
  return { base: row.slice(0, m.index), age: label === 'now' ? 0 : Number.parseInt(label, 10) * UNIT_MINUTES[unit] };
}

/**
 * Whether the two mounted Homes show the same rows, in the same order, with
 * the same text but for relative-time labels, and every mounted label is no
 * older than the same row's label on that side's reload: each label is the
 * row's age when it was last rendered (the label does not tick), so a
 * mounted side is behind only in when it last rendered the row.
 */
export function onlyStaleTimeLabels(e: CompactDom): boolean {
  const om = e.oldMounted.map(splitLabel), nm = e.newMounted.map(splitLabel);
  if (om.length !== nm.length || om.some((r, i) => r.base !== nm[i].base)) return false;
  if (om.every((r, i) => r.age === nm[i].age)) return false;
  for (const [mounted, reload] of [[e.oldMounted, e.oldReload], [e.newMounted, e.newReload]] as const) {
    const reloadAge = new Map<string, number | null>();
    for (const row of reload) {
      const k = keyOf(row);
      if (k) reloadAge.set(k, splitLabel(row).age);
    }
    for (const row of mounted) {
      const k = keyOf(row);
      if (!k || !reloadAge.has(k)) continue;
      const a = splitLabel(row).age, b = reloadAge.get(k) ?? null;
      if (a !== null && b !== null && a > b) return false;
    }
  }
  return true;
}

/**
 * Whether the two mounted Homes show the same rows, order and text but for
 * relative-time labels, where every label older than the same row's label
 * after that side's reload is on a mail row. Lists those rows. A mail row
 * with no open notification is labelled by the thread's updatedAt, which a
 * GraphQL list reads from the thread's one cached record (closure E1).
 */
export function staleMailLabels(e: CompactDom): { ok: boolean; rows: { key: string; side: 'old' | 'new'; mounted: string; reload: string }[] } {
  const om = e.oldMounted.map(splitLabel), nm = e.newMounted.map(splitLabel);
  const rows: { key: string; side: 'old' | 'new'; mounted: string; reload: string }[] = [];
  if (om.length !== nm.length || om.some((r, i) => r.base !== nm[i].base) || om.every((r, i) => r.age === nm[i].age)) return { ok: false, rows };
  for (const [side, mounted, reload] of [['old', e.oldMounted, e.oldReload], ['new', e.newMounted, e.newReload]] as const) {
    const reloadRow = new Map<string, string>();
    for (const row of reload) {
      const k = keyOf(row);
      if (k) reloadRow.set(k, row);
    }
    for (const row of mounted) {
      const k = keyOf(row);
      const other = k ? reloadRow.get(k) : undefined;
      if (!k || !other) continue;
      const a = splitLabel(row).age, b = splitLabel(other).age;
      if (a === null || b === null || a <= b) continue;
      if (!k.startsWith('email/')) return { ok: false, rows: [] };
      rows.push({ key: k, side, mounted: LABEL.exec(row)?.[1] ?? '', reload: LABEL.exec(other)?.[1] ?? '' });
    }
  }
  return { ok: rows.length > 0, rows };
}

/**
 * The closed class an open Home check moves to, judged from its recorded rows
 * (`checks.domRows`) and its open classes, or null when it stays open: main
 * held apart from shared staleness (B1), labels younger than the reload only
 * (L1), or older labels on mail rows only (E1). Used by report.ts and
 * partial.ts; the reloads must already agree.
 */
export function homeCheckClosure(recorded: CompactDom, open: string[]): { suffix: string; held: ReturnType<typeof heldApartFromShared>; mail: ReturnType<typeof staleMailLabels>['rows'] } | null {
  const e = withoutBranchOnlyInitiatives(recorded);
  const held = heldApartFromShared(e);
  if (held.newHeld) return { suffix: 'dom:old-behind-reload', held, mail: [] };
  if (!open.every((cls) => cls.endsWith(' dom:text'))) return null;
  if (onlyStaleTimeLabels(e)) return { suffix: 'dom:stale-time-label', held, mail: [] };
  const mail = staleMailLabels(e);
  return mail.ok ? { suffix: 'dom:stale-mail-label', held, mail: mail.rows } : null;
}

/**
 * The rows with initiative rows only the branch shows set aside, as lib/dom.ts
 * does live: they are D1, checked against the database when the step ran and
 * tallied apart. A heading left with no rows goes too.
 */
function withoutBranchOnlyInitiatives(e: CompactDom): CompactDom {
  const drop = (rows: string[], other: string[]) => {
    const keep = new Set(other.map(keyOf).filter(Boolean));
    const kept = rows.filter((row) => {
      const k = keyOf(row);
      return !k || !k.startsWith('initiative/') || keep.has(k);
    });
    return kept.filter((row, i) => !row.startsWith('# ') || (kept[i + 1] !== undefined && !kept[i + 1].startsWith('# ')));
  };
  return { ...e, newMounted: drop(e.newMounted, e.oldMounted), newReload: drop(e.newReload, e.oldReload) };
}
