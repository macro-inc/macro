// Home as rendered, compared at the caller's level. Rows are matched by the
// entity in their DOM id; relative times ("21m") are compared as written,
// except a one-unit tick between the two reads. Initiative rows that only
// the branch shows are checked against the database and reported as their
// own class (see closed.ts, D1), then set aside so the rest still compares.

import { classify } from './classify.ts';
import { compareDom, type Difference, type DomRow } from './compare.ts';
import { q, sql, type Stack, type User } from './stack.ts';

type EntityRow = Extract<DomRow, { kind: 'entity' }>;

/** `s8:soup-row|s6:entity|s10:initiative|s36:<id>|s5:today|u` → parts. */
export function parseRowId(id: string): { type: string; id: string; bucket: string } | null {
  const parts = id.split('|').map((p) => p.replace(/^s\d+:/, ''));
  if (parts[1] !== 'entity') return null;
  return { type: parts[2], id: parts[3], bucket: parts[4] };
}

const entityOf = (row: DomRow) => (row.kind === 'entity' ? parseRowId(row.id) : null);

/** Drops date headers left with no rows under them. */
function pruneHeaders(rows: DomRow[]): DomRow[] {
  return rows.filter((row, i) => row.kind !== 'header' || (rows[i + 1] !== undefined && rows[i + 1].kind === 'entity'));
}

/** Relative time at the end of a row's text, as one tick apart is the same read. */
function normalizeText(text: string): string {
  return text.replace(/(\d+)(m|h|d|w)$/, '<t:$2>');
}

function normalize(rows: DomRow[]): DomRow[] {
  return rows.map((row) => (row.kind === 'entity' ? { ...row, text: normalizeText(row.text) } : row));
}

export async function compareHomeDom(stack: Stack, viewer: User, oldRows: DomRow[], newRows: DomRow[], label: string): Promise<Difference[]> {
  const diffs: Difference[] = [];
  const key = (row: DomRow) => {
    const e = entityOf(row);
    return e ? `${e.type}:${e.id}` : null;
  };
  const oldKeys = new Set(oldRows.map(key).filter(Boolean));
  const extra = newRows.filter((row) => {
    const k = key(row);
    return k !== null && !oldKeys.has(k);
  }) as EntityRow[];
  const initiatives = extra.filter((row) => entityOf(row)?.type === 'initiative');
  let setAside = new Set<string>();
  if (initiatives.length) {
    // D1 holds only if the viewer really has an open notification on each.
    const ids = initiatives.map((row) => entityOf(row)?.id ?? '');
    const open = await sql<{ id: string }>(
      stack,
      `SELECT DISTINCT event_item_id AS id FROM user_notification WHERE user_id = ${q(viewer.macroUserId)} AND event_item_type = 'initiative' AND state::text <> 'done' AND deleted_at IS NULL AND event_item_id IN (${ids.map(q).join(',')})`
    );
    const confirmed = new Set(open.map((r) => r.id));
    for (const row of initiatives) {
      const id = entityOf(row)?.id ?? '';
      diffs.push({
        signature: `${label} dom:initiative-only-in-new:${confirmed.has(id) ? 'open-notification' : 'no-open-notification'}`,
        kind: 'dom',
        detail: row.text,
        new: row,
      });
    }
    setAside = new Set(initiatives.map((row) => row.id));
  }
  const rest = pruneHeaders(newRows.filter((row) => row.kind !== 'entity' || !setAside.has(row.id)));
  diffs.push(...compareDom(normalize(pruneHeaders(oldRows)), normalize(rest), label));
  return diffs;
}

export { classify };
