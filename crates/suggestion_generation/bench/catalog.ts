// The routine catalog as the judge reads it: what each ready-made routine
// does. Read from crates/routine_program/src/catalog.rs itself, so the bench
// always judges against the catalog of the checkout it runs from; a routine
// whose fields can't be read stops the bench instead of being judged blind.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Entry = {
  title: string;
  description: string;
  /** What someone asks for, with when it runs: the catalog's `request`. */
  does: string;
  surfaces: string[];
  /** Offered unpicked to fill a sidebar; otherwise only a session may pick it. */
  suggest: boolean;
};

const SOURCE = resolve(import.meta.dir, '../../routine_program/src/catalog.rs');

/** A Rust string literal's text. */
const unescape = (text: string) =>
  text.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/\\(["\\'])/g, '$1');

function field(block: string, name: string, key: string): string {
  const match = block.match(new RegExp(`\\n\\s+${name}: "((?:[^"\\\\]|\\\\.)*)",\\n`));
  if (!match) throw new Error(`catalog.rs: can't read ${name} of "${key}"`);
  return unescape(match[1]);
}

function read(): Record<string, Entry> {
  const blocks = readFileSync(SOURCE, 'utf8').split(/\n\s+CatalogRoutine \{/).slice(1);
  const entries = blocks.map((block): [string, Entry] => {
    const key = block.match(/\n\s+key: "([a-z_]+)",\n/)?.[1];
    const surfaces = block.match(/\n\s+surfaces: &\[([^\]]*)\],\n/)?.[1];
    const suggest = block.match(/\n\s+suggest: (true|false),\n/)?.[1];
    if (!key || surfaces === undefined || !suggest) throw new Error(`catalog.rs: can't read a routine's key, surfaces or suggest near "${block.slice(0, 80)}"`);
    return [
      key,
      {
        title: field(block, 'title', key),
        description: field(block, 'description', key),
        does: field(block, 'request', key),
        surfaces: [...surfaces.matchAll(/Surface::(\w+)/g)].map(([, name]) => name.toLowerCase()),
        suggest: suggest === 'true',
      },
    ];
  });
  if (entries.length < 10) throw new Error(`catalog.rs: read only ${entries.length} routines`);
  return Object.fromEntries(entries);
}

export const CATALOG: Record<string, Entry> = read();

type Sorted = { needs: { catalog: string[] }[]; decoys: { catalog?: string[] | null }[]; fine?: string[]; misfit?: string[] };

/**
 * What keeps a routines answer key from scoring every catalog pick: a key
 * the catalog lacks (renamed or removed), a routine it doesn't place, or one
 * it places twice (as a need's and a decoy, or fine and a misfit). Empty when
 * each catalog routine has exactly one place.
 */
export function keyGaps(truth: Sorted): string[] {
  if (!truth.fine || !truth.misfit) return ['has no fine and misfit lists: it predates scoring catalog picks by key; place every catalog routine (or write a new held-out set)'];
  const places = new Map<string, Set<string>>();
  const put = (key: string, place: string) => places.set(key, (places.get(key) ?? new Set()).add(place));
  for (const need of truth.needs) for (const key of need.catalog) put(key, 'a need');
  for (const decoy of truth.decoys) for (const key of decoy.catalog ?? []) put(key, 'a decoy');
  for (const key of truth.fine) put(key, 'fine');
  for (const key of truth.misfit) put(key, 'misfit');
  return [
    ...[...places.keys()].filter((key) => !CATALOG[key]).map((key) => `names "${key}", which catalog.rs lacks`),
    ...Object.keys(CATALOG).filter((key) => !places.has(key)).map((key) => `doesn't place "${key}" (a need's, a decoy's, fine or misfit)`),
    ...[...places].filter(([, where]) => where.size > 1).map(([key, where]) => `places "${key}" as ${[...where].join(' and ')}`),
  ];
}
