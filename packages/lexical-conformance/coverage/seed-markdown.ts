#!/usr/bin/env bun
// S4 traceability matrix generator (S4 §0.2).
//
// Spec time:   bun S4-matrix-gen.ts [--check]            (reads the specs beside this file)
// In the repo: bun packages/lexical-conformance/coverage/gen-matrix.ts [--check]
//              (reads checked-in docs and the recorder inventory)
//
// Inputs (read-only):
//   S2-feature-inventory.md  §2 export rows, §3 behaviour items (ids, class tags, AMBIGUOUS)
//   S3-packages.md           mapping tables (Rust column), "Not ported" sections, node tables,
//                            route map, §4.2.6 transformer table, §2.11 upstream transformer rows
//   S1-api.md                mapping tables (Rust column), n/a rows
//   S7-session.md            §6 behaviour table
//   S8-simulation.md         `covers: S7:<n>` tags and story tables (S7 column)
//   S4-tests.md              named tests: §1.8a/§1.8f symbol tables, §1.8g id overrides, §1.8e
//                            divergence regressions, §8.2 family rows, §8.3, §8.4, §8.6
//   upstream unit tests      fixtures/index.json (P0 name scan)
//   Macro cases              checked-in fixture index API/test-name inventory
// Output: coverage/seed-matrix.tsv (one row per traced item).
// --check: regenerate in memory and exit 1 if the file on disk differs.
//
// Deterministic: no clocks, no randomness, rows in source order.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(
  dirname(new URL(import.meta.url).pathname),
  '../../..'
);
export const SPEC =
  process.env.SPEC_DIR ?? join(ROOT, 'docs/design/lexical-port');
export const OUT = join(
  ROOT,
  'packages/lexical-conformance/coverage/seed-matrix.tsv'
);

export const HEADER = [
  'kind',
  'id',
  'package',
  'class',
  'pri',
  'owner',
  'gate',
  'tier',
  'test_id',
  'test_file',
  'also',
  'milestone',
  'source',
] as const;

// ---------- markdown indexing ----------
export type Row = {
  line: number;
  section: string;
  header: string[] | null;
  cells: string[];
  text: string;
};
export type Doc = {
  lines: string[];
  rows: Row[];
  sections: { line: number; title: string }[];
};

export function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'));
}

export function load(name: string): Doc {
  const lines = readFileSync(join(SPEC, name), 'utf8').split('\n');
  const rows: Row[] = [];
  const sections: { line: number; title: string }[] = [];
  let heads: string[] = [];
  let header: string[] | null = null;
  let inCode = false;
  lines.forEach((line, i) => {
    if (line.startsWith('```')) inCode = !inCode;
    const m = !inCode && /^(#{1,6}) (.*)/.exec(line);
    if (m) {
      heads = heads.slice(0, m[1].length - 1);
      heads[m[1].length - 1] = m[2];
      sections.push({ line: i + 1, title: m[2] });
      header = null;
      return;
    }
    if (!inCode && line.startsWith('|')) {
      const cells = splitRow(line);
      if (cells.every((c) => c === '' || /^:?-+:?$/.test(c))) return;
      if (/^\|\s*:?-/.test(lines[i + 1] ?? '')) {
        header = cells;
        return;
      }
      rows.push({
        line: i + 1,
        section: heads.filter(Boolean).slice(1).join(' > '),
        header,
        cells,
        text: line,
      });
    }
  });
  return { lines, rows, sections };
}

export const ticks = (s: string) =>
  [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
export const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wordRe = (sym: string) =>
  new RegExp(`(?<![\\w$])${esc(sym)}(?![\\w])`);
export const mentions = (sym: string, s: string) => {
  const r = wordRe(sym);
  return ticks(s).some((t) => r.test(t));
};
export const snake = (s: string) =>
  s
    .replace(/^\$/, '')
    .replace(/^@lexical\//, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
export const famOf = (id: string) => id.replace(/-?\d+[a-z]?$/, '');
