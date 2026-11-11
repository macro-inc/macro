import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFixtureText } from '../record/files';
import {
  type Doc,
  famOf,
  load,
  mentions,
  ROOT,
  type Row,
  snake,
  splitRow,
  ticks,
} from './seed-markdown';

export * from './seed-markdown';

export const S1 = load('S1-api.md');
export const S2 = load('S2-feature-inventory.md');
export const S3 = load('S3-packages.md');
export const S4 = load('S4-tests.md');
export const S7 = load('S7-session.md');
export const S8 = load('S8-simulation.md');

export function sectionLine(doc: Doc, re: RegExp): number {
  return doc.sections.find((s) => re.test(s.title))?.line ?? 0;
}

// ---------- S2 parsing ----------
export type Sym = {
  line: number;
  pkg: string;
  entry: string;
  sym: string;
  kind: string;
  what: string;
  cls: string;
  macro: string;
  target: string;
  pri: string;
};
export type Beh = {
  line: number;
  id: string;
  rawId: string;
  part: string;
  section: string;
  text: string;
  cls: string;
  clsSource: string;
  ambiguous: boolean;
};

export const syms: Sym[] = [];
export const behs: Beh[] = [];
{
  let inS2 = false,
    inS3 = false,
    pkg = '',
    entry = '',
    part = '';
  let heads: string[] = [];
  const seen = new Map<string, number>();
  S2.lines.forEach((line, i) => {
    if (line.startsWith('## 2.')) {
      inS2 = true;
      inS3 = false;
      return;
    }
    if (line.startsWith('## 3.')) {
      inS2 = false;
      inS3 = true;
      return;
    }
    if (/^## [4-9]\./.test(line)) {
      inS2 = inS3 = false;
      return;
    }
    if (inS2) {
      let m = /^### `([^`]+)`/.exec(line);
      if (m) {
        pkg = entry = m[1];
        return;
      }
      m = /^Entry point `([^`]+)`/.exec(line);
      if (m) {
        entry = m[1];
        return;
      }
      if (line.startsWith('| [')) {
        const c = splitRow(line);
        if (c.length < 8) return;
        syms.push({
          line: i + 1,
          pkg,
          entry,
          sym: c[1].replace(/`/g, ''),
          kind: c[2],
          what: c[3],
          cls: c[4],
          macro: c[5],
          target: c[6],
          pri: c[7],
        });
      }
    }
    if (inS3) {
      const h = /^(#{3,5}) (.*)/.exec(line);
      if (h) {
        heads = heads.slice(0, h[1].length - 3);
        heads[h[1].length - 3] = h[2];
        if (h[1].length === 3) part = h[2].slice(0, 2);
        return;
      }
      const m = /^\s*- \[[ x]\] \*\*([A-Z0-9][A-Za-z0-9_-]*)\*\*\s*(.*)/.exec(
        line
      );
      if (!m) return;
      const raw = m[1],
        text = m[2];
      const n = (seen.get(raw) ?? 0) + 1;
      seen.set(raw, n);
      // G-2: the §3D copies of SEL-nn are LSEL-nn (S2 R2 rename); any other duplicate is qualified.
      let id = raw;
      if (n > 1)
        id =
          famOf(raw) === 'SEL' && part === '3D'
            ? raw.replace(/^SEL-/, 'LSEL-')
            : `${raw}@${part}`;
      const lead = /^(MODEL|BRIDGE|VIEW)\b/.exec(text);
      const inline =
        /—\s*(MODEL|BRIDGE|VIEW)(?:\s*\(|\s*\/|\s*$|\s*\.|\s*;)/.exec(text);
      const cls = lead?.[1] ?? inline?.[1] ?? '';
      behs.push({
        line: i + 1,
        id,
        rawId: raw,
        part,
        section: heads.filter(Boolean).join(' > '),
        text,
        cls,
        clsSource: cls ? 'item' : '',
        ambiguous: /AMBIGUOUS/.test(text),
      });
    }
  });
}

// ---------- family table (class default, owner, package, milestone) ----------
// Class defaults are S4 §8.2's family class; an item-level tag in S2 wins.
export type Fam = { cls: string; owner: string; pkg: string; ms: string };
export const RICH = 'rust:lexical_rich_nodes',
  MODEL = 'rust:lexical_model',
  MD = 'rust:lexical_markdown';
export const FAM: Record<string, Fam> = {
  CMD: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  EVT: { cls: 'BRIDGE', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  RT: { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/rich-text', ms: 'M1' },
  PT: { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/plain-text', ms: 'M1' },
  DRG: { cls: 'VIEW', owner: 'view', pkg: '@lexical/dragon', ms: 'M3' },
  NRM: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  EL: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  TX: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  FMT: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  NODE: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  ID: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  TF: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  UPD: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  TAG: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  LST: { cls: 'BRIDGE', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  JSON: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M0' },
  NS: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  CFG: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  CARET: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  SEL: { cls: 'MODEL', owner: MODEL, pkg: 'lexical', ms: 'M1' },
  LSEL: { cls: 'MODEL', owner: RICH, pkg: '@lexical/selection', ms: 'M1' },
  'LNK-CL': { cls: 'VIEW', owner: 'view', pkg: '@lexical/link', ms: 'M3' },
  HT: { cls: 'MODEL', owner: RICH, pkg: '@lexical/hashtag', ms: 'M1' },
  TXT: { cls: 'MODEL', owner: RICH, pkg: '@lexical/text', ms: 'M1' },
  OVF: { cls: 'MODEL', owner: RICH, pkg: '@lexical/overflow', ms: 'M1' },
  OFF: { cls: 'MODEL', owner: RICH, pkg: '@lexical/offset', ms: 'M1' },
  MRK: { cls: 'MODEL', owner: RICH, pkg: '@lexical/mark', ms: 'M1' },
  TW: { cls: 'VIEW', owner: 'view', pkg: '@lexical/tailwind', ms: 'M3' },
  FILE: { cls: 'VIEW', owner: 'view', pkg: '@lexical/file', ms: 'M3' },
  'PATCH-TBL': { cls: 'MODEL', owner: RICH, pkg: '@lexical/table', ms: 'M1' },
  'PATCH-MD': { cls: 'MODEL', owner: MD, pkg: '@lexical/markdown', ms: 'M1' },
  'PATCH-NONE': {
    cls: 'MODEL',
    owner: 'rust:macro_document_model',
    pkg: 'apps/web/patches',
    ms: 'M1',
  },
  'TBL-KEY': { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/table', ms: 'M1' },
  'TBL-OBS': { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/table', ms: 'M1' },
  'TBL-PTR': { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/table', ms: 'M1' },
  'LST-KEY': { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/list', ms: 'M1' },
  'CODE-NODE': {
    cls: 'MODEL',
    owner: RICH,
    pkg: '@lexical/code-core',
    ms: 'M1',
  },
  'CODE-KEY': {
    cls: 'BRIDGE',
    owner: RICH,
    pkg: '@lexical/code-core',
    ms: 'M1',
  },
  'CODE-HL': {
    cls: 'VIEW',
    owner: 'upstream-js',
    pkg: '@lexical/code-core',
    ms: 'M3',
  },
  'CODE-PR': {
    cls: 'VIEW',
    owner: 'upstream-js',
    pkg: '@lexical/code-prism',
    ms: 'M3',
  },
  'CODE-SH': {
    cls: 'VIEW',
    owner: 'upstream-js',
    pkg: '@lexical/code-shiki',
    ms: 'M3',
  },
  HIS: { cls: 'MODEL', owner: MODEL, pkg: '@lexical/history', ms: 'M1' },
  CLP: { cls: 'BRIDGE', owner: RICH, pkg: '@lexical/clipboard', ms: 'M1' },
  HTML: { cls: 'BRIDGE', owner: 'upstream-js', pkg: '@lexical/html', ms: 'M3' },
  HREN: { cls: 'BRIDGE', owner: 'upstream-js', pkg: '@lexical/html', ms: 'M3' },
  HIMP: { cls: 'BRIDGE', owner: 'upstream-js', pkg: '@lexical/html', ms: 'M3' },
  EXT: {
    cls: 'MODEL',
    owner: 'upstream-js',
    pkg: '@lexical/extension',
    ms: 'M3',
  },
  XB: {
    cls: 'MODEL',
    owner: 'upstream-js',
    pkg: '@lexical/extension',
    ms: 'M3',
  },
  HDL: { cls: 'MODEL', owner: MODEL, pkg: '@lexical/headless', ms: 'M1' },
  YJS: { cls: 'REFERENCE', owner: 'reference', pkg: '@lexical/yjs', ms: 'M3' },
  UTL: { cls: 'MODEL', owner: RICH, pkg: '@lexical/utils', ms: 'M1' },
};
export function famInfo(fam: string): Fam {
  if (FAM[fam]) return FAM[fam];
  if (fam.startsWith('MD-'))
    return { cls: 'MODEL', owner: MD, pkg: '@lexical/markdown', ms: 'M1' };
  if (fam.startsWith('LNK-'))
    return { cls: 'MODEL', owner: RICH, pkg: '@lexical/link', ms: 'M1' };
  if (fam.startsWith('TBL-'))
    return { cls: 'MODEL', owner: RICH, pkg: '@lexical/table', ms: 'M1' };
  if (fam.startsWith('LST-'))
    return { cls: 'MODEL', owner: RICH, pkg: '@lexical/list', ms: 'M1' };
  if (fam.startsWith('RX-'))
    return {
      cls: 'BRIDGE',
      owner: 'upstream-js',
      pkg: '@lexical/react',
      ms: 'M3',
    };
  throw new Error(`no family entry for ${fam}`);
}
// React plugins whose model half Macro uses (S4 §8.2 RX row) are Rust; the rest stay upstream JS.
export const RX_RUST = new Set([
  'RX-CLEAR',
  'RX-TABLE',
  'RX-LIST',
  'RX-CHECK',
  'RX-MDSC',
  'RX-TAB',
  'RX-HIST',
]);
// S3 1a.17: ClearEditor and TabIndentation are ported; the rest of @lexical/extension runs upstream JS.
export const XB_RUST = new Set([
  'XB-04',
  'XB-11',
  'XB-12',
  'XB-13',
  'XB-14',
  'XB-15',
]);

// Not-ported anchors in S3, by family, for the ledger cite.
export const NP_ANCHOR: Record<string, number> = {
  EXT: sectionLine(S3, /^1a\.17 /),
  XB: sectionLine(S3, /^1a\.17 /),
  RX: sectionLine(S3, /^1a\.17 /),
  'CODE-HL': sectionLine(S3, /^1c\.1\.9 /),
  'CODE-PR': sectionLine(S3, /^1c\.1\.9 /),
  'CODE-SH': sectionLine(S3, /^1c\.1\.9 /),
  HTML: sectionLine(S3, /^3\.11 /),
  HREN: sectionLine(S3, /^3\.11 /),
  HIMP: sectionLine(S3, /^3\.11 /),
};
export const notPortedRows = S3.lines.map((l, i) => ({ l, i: i + 1 }));
export const npSections = S3.sections
  .filter((s) => /not ported/i.test(s.title))
  .map((s) => s.line);
export function s3NotPortedCite(fam: string, text: string): string {
  // Prefer the "Not ported" line that names one of the item's identifiers.
  const ids = ticks(text).flatMap(
    (t) => t.match(/\$?[A-Za-z_][\w]{3,}/g) ?? []
  );
  for (const start of npSections) {
    const end =
      S3.sections.find((s) => s.line > start)?.line ?? S3.lines.length;
    for (let i = start; i < end; i++)
      if (ids.some((w) => mentions(w, S3.lines[i - 1]))) return `S3:${i}`;
  }
  const a = NP_ANCHOR[fam] ?? NP_ANCHOR[fam.split('-')[0]];
  return a ? `S3:${a}` : 'S2:target';
}

// ---------- S4 named tests ----------
export function s4Rows(sectionRe: RegExp) {
  return S4.rows.filter((r) => sectionRe.test(r.section));
}
// A test id: `ns::…::name` with a lowercase first segment, or a `*.test.ts::case`.
export const testTicks = (cell: string) =>
  ticks(cell).filter((t) =>
    /^(…|[a-z_][a-z0-9_]*)::|\.test(-d)?\.ts(::|$)/.test(t)
  );
// S7 rows also cite S8 invariants and stories by bare snake_case name.
export const s7Ticks = (cell: string) =>
  ticks(cell).filter((t) =>
    /^(…|[a-z_][a-z0-9_]*)::|\.test(-d)?\.ts(::|$)|^[a-z][a-z0-9]*_[a-z0-9_]+$/.test(
      t
    )
  );

// §1.8a + §1.8f: symbol → tests (§1.8f, the R2 table, wins).
export const symOverride = new Map<
  string,
  { tests: string[]; tier: string; src: string }
>();
for (const sec of [/1\.8a /, /1\.8f /])
  for (const r of s4Rows(sec)) {
    if ((r.header?.[1] ?? '') !== 'Test id') continue;
    const tests = testTicks(r.cells[1]);
    const tier = r.cells[2] ?? '';
    for (const t of ticks(r.cells[0])) {
      if (t.startsWith('@lexical/') || t === 'lexical' || t.includes(' '))
        continue;
      const named = (tests.length ? tests : [r.cells[1]]).map((x) =>
        x.replaceAll('{name}', t)
      );
      symOverride.set(t, { tests: named, tier, src: `S4:${r.line}` });
    }
  }
// §1.8g: behaviour id → test (ids S4 or S8 already name, and R2 additions).
export const idOverride = new Map<
  string,
  { test: string; tier: string; src: string }
>();
for (const r of s4Rows(/1\.8g /)) {
  if ((r.header?.[0] ?? '') !== 'S2 id') continue;
  const ids: string[] = [];
  for (const part of r.cells[0]
    .split(/,\s*/)
    .map((x) => x.replace(/`/g, '').trim())
    .filter(Boolean)) {
    const rg = /^([A-Z][A-Z-]*?)-?(\d+)\.\.\1-?(\d+)$/.exec(part);
    if (!rg) {
      ids.push(part);
      continue;
    }
    const width = rg[2].length,
      sep = part.includes(`${rg[1]}-`) ? '-' : '';
    for (let n = +rg[2]; n <= +rg[3]; n++)
      ids.push(`${rg[1]}${sep}${String(n).padStart(width, '0')}`);
  }
  // A later row wins (a specific id after its range).
  for (const id of ids)
    idOverride.set(id, {
      test: (ticks(r.cells[1])[0] ?? r.cells[1]).replaceAll('{id}', snake(id)),
      tier: r.cells[2] ?? 'A-hand',
      src: `S4:${r.line}`,
    });
}
// §1.8e: audit-r2-1 divergence regressions.
export const divRows = s4Rows(/1\.8e /).filter((r) =>
  /^R2-\d+/.test(r.cells[0])
);
// §1.8h: private fields Macro reads (G-9).
export const privRows = s4Rows(/1\.8h /).filter(
  (r) => r.header?.[0] === 'Field'
);
// §8.2 family rows: the "also" column (C + e2e/other).
export const famAlso = new Map<string, string>();
for (const r of s4Rows(/8\.2 /)) {
  const c = r.cells;
  if (c.length < 7) continue;
  const also = [c[5], c[6]]
    .filter((x) => x && x !== '–')
    .join('; ')
    .replace(/\t/g, ' ');
  for (const m of c[0].matchAll(
    /([A-Z][A-Z]+(?:-[A-Z]+)?(?:-\*)?)\s*(?:\(|,|$)/g
  ))
    famAlso.set(m[1], also);
}
export const alsoFor = (fam: string) =>
  famAlso.get(fam) ??
  (fam.startsWith('RX-') ? famAlso.get('RX-*') : undefined) ??
  (fam === 'LSEL' ? famAlso.get('SEL') : undefined) ??
  '';
// §8.3 nodes, §8.4 routes, §8.6 S7 rows.
export const nodeTests = new Map<string, Row>();
for (const r of s4Rows(/8\.3 /))
  for (const t of ticks(r.cells[0])) nodeTests.set(t, r);
export const routeTests = new Map<string, Row>();
for (const r of s4Rows(/8\.4 /))
  for (const n of r.cells[0].match(/\d+/g) ?? []) routeTests.set(n, r);
export const s7Tests = new Map<number, Row>();
for (const r of s4Rows(/8\.6 /)) {
  const cell = r.cells[0];
  for (const part of cell.split(/,\s*/)) {
    const rg = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part.trim());
    if (rg) for (let n = +rg[1]; n <= +rg[2]; n++) s7Tests.set(n, r);
    else if (/^\d+$/.test(part.trim())) s7Tests.set(+part.trim(), r);
  }
}
// S8: `covers: S7:n` tags and story-table S7 columns.
export const s8ByRow = new Map<number, string[]>();
{
  let pendingCovers: number[] = [];
  S8.lines.forEach((l) => {
    const cv = /covers:(.*)/.exec(l);
    if (cv) pendingCovers = [...cv[1].matchAll(/S7:(\d+)/g)].map((m) => +m[1]);
    const fn = /fn ([a-z_0-9]+)/.exec(l);
    if (fn && pendingCovers.length) {
      for (const n of pendingCovers)
        (s8ByRow.get(n) ?? s8ByRow.set(n, []).get(n)!).push(`S8:${fn[1]}`);
      pendingCovers = [];
    }
    if (l.startsWith('|') && /S7:\d+/.test(l)) {
      const c = splitRow(l);
      const name = ticks(c[0])[0];
      if (name)
        for (const m of c[c.length - 1].matchAll(/S7:(\d+)/g))
          (s8ByRow.get(+m[1]) ?? s8ByRow.set(+m[1], []).get(+m[1])!).push(
            `S8:${name}`
          );
    }
  });
}

// ---------- S1/S3 export status (as audit-r2-2 check 1a) ----------
export const S13 = [
  ...S1.rows.map((r) => ({ ...r, doc: 'S1' })),
  ...S3.rows.map((r) => ({ ...r, doc: 'S3' })),
];
// A line counts as "not ported" when its nearest heading says so, or the line itself does.
export function npFlags(doc: Doc): boolean[] {
  const flags: boolean[] = [];
  let cur = false,
    k = 0;
  const secs = doc.sections;
  doc.lines.forEach((_, i) => {
    while (k < secs.length && secs[k].line <= i + 1) {
      cur = /not ported|stays? (in )?js/i.test(secs[k].title);
      k++;
    }
    flags.push(cur);
  });
  return flags;
}
export const S1np = npFlags(S1),
  S3np = npFlags(S3);
export const S13lines = [
  ...S1.lines.map((l, i) => ({ l, at: `S1:${i + 1}`, np: S1np[i] })),
  ...S3.lines.map((l, i) => ({ l, at: `S3:${i + 1}`, np: S3np[i] })),
];
export const NP_TEXT =
  /not ported|stays? (in )?js|view[- ]only|\*\*not\*\* ported/i;
export const NA = /^(n\/a|view|not ported|stays|js|shim|none|dropped|–|-)\b/i;
export function rustCell(r: Row): string | null {
  const h = r.header ?? [];
  const j = h.findIndex((x) => /\brust\b/i.test(x));
  return j >= 0 && j < r.cells.length ? r.cells[j] : null;
}
export function exportStatus(sym: string): { st: string; at: string } {
  let best: { st: string; at: string } | null = null;
  for (const r of S13) {
    if (!r.text.includes(sym) || !mentions(sym, r.text)) continue;
    const rc = rustCell(r);
    if (rc === null) continue;
    // The symbol must be in the row's upstream-name column (the first non-Rust column), or be
    // the Rust cell itself; a "via X" mention in a later column is not a mapping of X.
    const h = r.header ?? [];
    const upIdx = h.findIndex(
      (x, j) => r.cells[j] !== rc && !/\brust\b/i.test(x)
    );
    const upCell = upIdx >= 0 ? (r.cells[upIdx] ?? '') : '';
    if (!mentions(sym, upCell) && !mentions(sym, rc)) continue;
    const at = `${r.doc}:${r.line}`;
    if (
      NA.test(rc.replace(/[` ]/g, '')) ||
      /not ported/i.test(rc) ||
      /^view/i.test(rc)
    )
      best ??= { st: 'na', at };
    else if (/not ported/i.test(r.section)) best ??= { st: 'not-ported', at };
    else return { st: 'mapped', at };
  }
  if (best) return best;
  for (const { l, at, np } of S13lines)
    if (l.includes(sym) && mentions(sym, l) && (np || NP_TEXT.test(l)))
      return { st: 'not-ported', at };
  for (const { l, at } of S13lines)
    if (l.includes(sym) && mentions(sym, l)) return { st: 'prose', at };
  return { st: 'unmapped', at: '' };
}

// ---------- test-source scans (P0 symbols no test names) ----------
export const fixtureIndex: { id: string; apis: string[] }[] = JSON.parse(
  readFixtureText(
    join(ROOT, 'packages/lexical-conformance/fixtures/index.json')
  )
);
// Seed planning uses the checked-in recorder inventory, independent of local archives.
export const upText = fixtureIndex
  .filter((row) => !row.id.startsWith('lexical-core/'))
  .flatMap((row) => [row.id, ...row.apis])
  .join('\n');
export const macText = fixtureIndex
  .filter((row) => row.id.startsWith('lexical-core/'))
  .flatMap((row) => [row.id, ...row.apis])
  .join('\n');
