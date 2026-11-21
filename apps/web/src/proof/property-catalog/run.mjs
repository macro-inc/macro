// Differential fuzz of the property catalog: the base commit's query modules
// (OLD, REST queryFns) against the PR head's (NEW, GraphQL readers), side by
// side in one browser on the local stack. See README.md for what it compares.
//
// Usage: node run.mjs   (configured by environment variables, see CONFIG)
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// This driver answers every API request of every page (its route handlers), so
// a stall of its event loop delays every page's answers at once. Stalls of
// 100 ms or more are kept, so a settle timeout can show whether it waited on
// the driver rather than on the server or the page.
const driverStalls = [];
{
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const ms = Math.round(now - last - 50);
    if (ms >= 100) {
      driverStalls.push({ end: Date.now(), ms });
      if (driverStalls.length > 500) driverStalls.shift();
    }
    last = now;
  }, 50).unref();
}
const ROOT = path.resolve(HERE, '../../../../..');
const E = process.env;

// ---------------------------------------------------------------- CONFIG ----
const CONFIG = {
  base: (E.BASE ?? 'https://localhost:24709').replace(/\/$/, ''),
  seed: Number(E.SEED ?? 1),
  seqs: Number(E.SEQS ?? 200), // stateful sequences, split across lanes
  steps: Number(E.STEPS ?? 20), // writes per sequence
  lanes: Number(E.LANES ?? 4), // independent account pairs run at once
  // Sequences per account pair before new accounts. The local auth service lets
  // one address create 50 users an hour, so pairs are reused this long.
  rotate: Number(E.ROTATE ?? 25),
  readsPerStep: Number(E.READS_PER_STEP ?? 3), // random raw read cases per step
  sweep: E.SWEEP !== '0', // all 112 listing keys + every option id per account pair
  volume: Number(E.VOLUME ?? 2500), // definitions in the volume account (0: skip)
  load: Number(E.LOAD ?? 0), // concurrent load pages (other accounts + same-user readers)
  mutant: E.MUTANT ?? '', // drop-row | swap-order | alter-field | stale-cache | skip-live-update
  mutantRate: Number(E.MUTANT_RATE ?? 0.3),
  control: E.CONTROL === '1', // both sides OLD: the old code against itself
  settleMs: Number(E.SETTLE_MS ?? 5000), // live-update bound
  pg: E.PG_CONTAINER ?? 'macro-gqlprops-postgres-1',
  redis: E.REDIS_CONTAINER ?? 'macro-gqlprops-redis-1', // '' to wait out the sign-up limit instead
  headless: E.HEADED !== '1',
};
const OUT = path.resolve(
  E.OUT ??
    path.join(
      HERE,
      'out',
      `seed-${CONFIG.seed}${CONFIG.mutant ? `-mutant-${CONFIG.mutant}` : ''}${CONFIG.control ? '-control' : ''}${CONFIG.load ? '-load' : ''}`
    )
);
fs.mkdirSync(OUT, { recursive: true });
// A results file left by an earlier run in this directory is never read as this run's.
fs.rmSync(path.join(OUT, 'results.json'), { force: true });
fs.writeFileSync(path.join(OUT, 'started'), new Date().toISOString());
const PW = E.PW_PATH ?? path.join(ROOT, 'node_modules/playwright/index.mjs');
const { chromium } = await import(PW);
const ORIGIN = new URL(CONFIG.base).origin;
const STAMP = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ------------------------------------------------------------ seeded PRNG ----
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function rng(seed) {
  const r = mulberry32(seed);
  const int = (n) => Math.floor(r() * n);
  return {
    r,
    int,
    pick: (xs) => xs[int(xs.length)],
    chance: (p) => r() < p,
    weighted: (pairs) => {
      const total = pairs.reduce((s, [, w]) => s + w, 0);
      let x = r() * total;
      for (const [v, w] of pairs) if ((x -= w) < 0) return v;
      return pairs[pairs.length - 1][0];
    },
  };
}

// ------------------------------------------------------------- generators ----
const ENTITY_TYPES = ['CALENDAR_EVENT', 'CALL_RECORD', 'CHANNEL', 'CHAT', 'COMPANY', 'DATABASE_ROW', 'CONTACT', 'DOCUMENT', 'INITIATIVE', 'PROJECT', 'TASK', 'THREAD', 'USER'];
const SCOPES = ['user', 'team', 'system', 'all'];
const LIST_KEYS = SCOPES.flatMap((scope) => [true, false].flatMap((includeOptions) => [undefined, ...ENTITY_TYPES].map((forEntityType) => ({ scope, includeOptions, forEntityType }))));
const NAME_STEMS = ['Status', 'status', 'STATUS', 'priority', 'Owner', 'Due', 'Score', 'Ärger', 'ärger', 'naïve', 'Éclair', 'zeta', 'Zeta', 'ZETA', '名前', 'Ünïcödé', '🚀 launch', '_under', '1numeric', 'a', 'A', 'b', 'Mixed Case', 'mixed case', 'İstanbul', 'ß-strasse', 'SS-STRASSE', 'Stage', ' leading space', 'trailing space ', 'tab\there', 'emoji 👩‍👩‍👧', 'RTL שלום', 'zero​width'];
const OPT_STRINGS = ['Alpha', 'alpha', 'ALPHA', 'Beta', 'Ωmega', '名前', '🚀', 'Done', 'done', 'In Progress', '  spaced  ', 'Zulu', 'ärger', 'Ärger', 'Ä', 'a', 'A', 'RTL שלום', '0', '-1'];
// Colors are for tag options only; the server refuses one on other options and a tag without one.
const TAG_COLORS = ['#FF0000', '#00AA88', '#7C3AED', '#ffffff', '#123456', '#abcdef'];
const COLORS = [null, null, '#FF0000', '#00AA88', '#7C3AED', '#ffffff', '#123456', '#abcdef'];

function makeGen(g) {
  // The server takes 1-100 characters; one in ten long names is over, and refused.
  const longName = () => `${g.pick(NAME_STEMS)} ${'long-'.repeat(g.chance(0.1) ? 21 + g.int(30) : 10 + g.int(8))}`.slice(0, g.chance(0.5) ? 100 : 300);
  const name = () => {
    if (g.chance(0.06)) return longName();
    const stem = g.pick(NAME_STEMS);
    return g.chance(0.55) ? stem : `${stem} ${g.int(6)}`; // small suffix space: LOWER(name) ties are common
  };
  const number = () => (g.chance(0.35) ? g.pick([0, 1, -1, 2.5, -0.001, 1e9, 0.1 + 0.2, 1e-9, -1e15, 123456.789]) : (g.int(2e6) - 1e6) / g.pick([1, 10, 1000]));
  const optString = () => (g.chance(0.05) ? 'x'.repeat(100 + g.int(200)) : g.pick(OPT_STRINGS) + (g.chance(0.4) ? ` ${g.int(20)}` : ''));
  const displayOrder = () => (g.chance(0.4) ? 0 : g.pick([0, 1, 2, 3, -1, 1000, 2147483647]));
  const dataType = () => {
    const k = g.weighted([['boolean', 1], ['date', 1], ['date_range', 0.5], ['number', 1], ['string', 1], ['link', 1], ['entity', 2], ['select_string', 3], ['select_number', 2]]);
    if (k === 'link') return { type: 'link', multi: g.chance(0.5) };
    if (k === 'entity') return { type: 'entity', multi: g.chance(0.5), specific_type: g.chance(0.3) ? null : g.pick(ENTITY_TYPES) };
    if (k === 'select_string') return { type: k, multi: g.chance(0.5), options: Array.from({ length: g.int(5) }, () => ({ display_order: displayOrder(), value: optString(), ...(g.chance(0.04) ? { color: g.pick(TAG_COLORS) } : {}) })) };
    if (k === 'select_number') return { type: k, multi: g.chance(0.5), options: Array.from({ length: g.int(5) }, () => ({ display_order: displayOrder(), value: number() })) };
    return { type: k };
  };
  return { name, number, optString, displayOrder, dataType };
}

// ----------------------------------------------------- normalize and diff ----
function sortKeys(x, mapString, key = '', parent = null) {
  if (Array.isArray(x)) return x.map((v) => sortKeys(v, mapString, key, null));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = sortKeys(x[k], mapString, k, x);
    return o;
  }
  return typeof x === 'string' && mapString ? mapString(x, key, parent) : x;
}
const J = (x) => JSON.stringify(sortKeys(x));

// Timestamps: REST writes `...Z`, GraphQL `...+00:00`. Two strings count as
// the same only when both parse and name the same instant to the nanosecond,
// and only on a row's own created/updated field (an object with an id), never
// on an option value or a name that looks like a date.
const ISO_TS = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;
function instant(s) {
  const m = ISO_TS.exec(s);
  if (!m) return null;
  const [, y, mo, d, h, mi, se, frac = '', off] = m;
  const utc = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  if (utc.getUTCFullYear() !== +y || utc.getUTCMonth() !== +mo - 1 || utc.getUTCDate() !== +d || utc.getUTCHours() !== +h || utc.getUTCMinutes() !== +mi || utc.getUTCSeconds() !== +se) return null;
  let offMin = 0;
  if (off !== 'Z') {
    const digits = off.slice(1).replace(':', '');
    const oh = Number(digits.slice(0, 2));
    const om = Number(digits.slice(2, 4) || 0);
    if (oh > 23 || om > 59) return null;
    offMin = (off[0] === '-' ? -1 : 1) * (oh * 60 + om);
  }
  // NUL-prefixed, so no literal field value can collide with a normalized one
  // (a literal that starts with NUL gets a second one, below).
  return `\u0000@${utc.getTime() / 1000 - offMin * 60}.${frac.padEnd(9, '0')}`;
}
const TS_KEY = /^(created|updated)_?at$/i;
// A row: an object that names itself (a definition, option, tag set, or a
// caller's property built from one).
const ROW_ID_KEYS = ['id', 'propertyId', 'definitionId', 'propertyDefinitionId', 'property_definition_id'];
const isRow = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && ROW_ID_KEYS.some((k) => typeof o[k] === 'string');
const tsNorm = (s, key, parent) => {
  if (!TS_KEY.test(key) || !isRow(parent)) return s;
  return instant(s) ?? (s.startsWith('\u0000') ? `\u0000${s}` : s);
};
const JT = (x) => JSON.stringify(sortKeys(x, tsNorm));
// Tie keys lowercase the way the server sorted that list. Definitions with
// options are sorted in Rust (`to_lowercase`: Unicode's full mapping, as
// JavaScript's toLowerCase). Plain definitions, options and tag options are
// sorted in PostgreSQL (`LOWER` under the database's libc collation:
// towlower, one code point at a time, so `İ` becomes `i`, not `i̇`, and a
// final `Σ` stays `σ`). `sqlLower` maps one code point at a time; every
// string it lowered is kept, and the run asks PostgreSQL at its end to lower
// each one and fails if any differs (checkCollation).
const LOWERED = new Set();
const rustLower = (s) => String(s ?? '').toLowerCase();
const sqlLower = (s) => {
  const str = String(s ?? '');
  if (LOWERED.size < 200000) LOWERED.add(str);
  let out = '';
  for (const ch of str) {
    const l = ch.toLowerCase();
    // A code point whose full lowercase is longer (only U+0130) takes its simple mapping.
    out += [...l].length === 1 ? l : ch === '\u0130' ? 'i' : l;
  }
  return out;
};

// Tie order. The server sorts definitions by lowercased display_name and
// options by (display_order, number_value, LOWER(string_value)) (tag options:
// display_order, LOWER(string_value)), with no tiebreaker, so rows whose keys
// are equal come back in either order on both paths. Only those lists are
// canonicalized, by sorting each run of equal keys by id; the outer tag-set
// list and every other array keep their order.
const rowId = (el) => (Array.isArray(el) ? (typeof el[0] === 'string' ? el[0] : undefined) : (el?.definition?.id ?? el?.id ?? el?.propertyId ?? el?.definitionId));
function defKey(e) {
  const d = e?.definition ?? e;
  if (!d || typeof d !== 'object' || typeof d.display_name !== 'string') return null;
  // A definition with options (`{ definition, property_options }`) came from the Rust sort.
  return e?.definition ? `d:${rustLower(d.display_name)}` : `d:${sqlLower(d.display_name)}`;
}
function optKey(o) {
  // REST options are snake case, REST tag options camel case.
  const order = o?.display_order ?? o?.displayOrder;
  if (!o || typeof o !== 'object' || typeof order !== 'number' || !o.value || typeof o.value !== 'object') return null;
  const v = o.value.value;
  if (typeof v === 'number') return `o:${order}|${v}|`;
  if (typeof v === 'string') return `o:${order}||${sqlLower(v)}`;
  return null;
}
const byId = (a, b) => {
  const x = String(rowId(a));
  const y = String(rowId(b));
  return x < y ? -1 : x > y ? 1 : 0;
};
function runsSorted(xs, keyOf) {
  if (!Array.isArray(xs)) return xs;
  const keys = xs.map(keyOf);
  const out = [];
  for (let i = 0; i < xs.length; ) {
    let j = i + 1;
    if (keys[i] !== null && keys[i] !== undefined) while (j < xs.length && keys[j] === keys[i]) j++;
    out.push(...xs.slice(i, j).sort(byId));
    i = j;
  }
  return out;
}
const canonOptions = (list) => runsSorted(list, optKey);
const canonDefs = (list) => runsSorted(Array.isArray(list) ? list.map((e) => (e && Array.isArray(e.property_options) ? { ...e, property_options: canonOptions(e.property_options) } : e)) : list, defKey);
const canonTags = (sets) => (Array.isArray(sets) ? sets.map((s) => (s && Array.isArray(s.options) ? { ...s, options: canonOptions(s.options) } : s)) : sets);
// The canonicalizer for one read, by what it reads.
const canonFor = (k) => (k === 'defs' ? canonDefs : k === 'opts' ? canonOptions : k === 'tags' ? canonTags : (x) => x);
const readerKind = (id) => {
  try {
    return JSON.parse(id.replace(/^reader/, '')).k;
  } catch {
    return null;
  }
};

// Callers derive their arrays from those lists. Two caller rows may swap only
// when the server tied them: each row id gets the tie key the server sorted it
// by (from the lists the callers read), and a run of adjacent rows sharing
// one key is sorted by id. A row whose key is unknown, or differs between the
// sides, keeps its place.
function tieGroups(snapshot, source) {
  const g = new Map();
  const put = (id, key) => {
    if (!id || key === null || key === undefined) return;
    if (g.has(id) && g.get(id) !== key) g.set(id, null);
    else if (!g.has(id)) g.set(id, key);
  };
  // An option with no key keeps its place: no group, never a shared `id|null` one.
  const optIn = (scope, o) => {
    const k = optKey(o);
    return k === null ? null : `${scope}|${k}`;
  };
  const defs = (list) => {
    for (const e of Array.isArray(list) ? list : []) {
      const id = rowId(e);
      put(id, defKey(e));
      for (const o of e?.property_options ?? []) put(o?.id, optIn(id, o));
    }
  };
  const tagSets = (sets) => {
    for (const s of Array.isArray(sets) ? sets : []) for (const o of s?.options ?? []) put(o?.id, optIn(s?.definition?.id, o));
  };
  // Only the listings the callers read (harness.tsx `__sources`): a reader
  // listing sorted another way (plain definitions, by SQL) must not change a
  // caller row's key.
  const src = snapshot?.callers?.__sources;
  if (source === 'opts') {
    for (const e of Array.isArray(src?.opts) ? src.opts : []) for (const o of Array.isArray(e?.options) ? e.options : []) put(o?.id, optIn(e.id, o));
  } else if (source === 'tags') tagSets(src?.tags);
  else if (source) defs(src?.[source]);
  return g;
}
// The one list each caller derives its rows from (harness.tsx): rows tie only
// as that list's server sort tied them. A caller missing here gets no ties.
const CALLER_SOURCES = {
  propertyPanel: 'all', // useAllProperties: scope all, with options
  crmStages: 'all', // stage-adapter.ts: scope all, with options
  crmExport: 'crmExport',
  taskBoard: 'system',
  projects: 'system',
  filterBar: 'tags', // tag-filter-state: useTagsQuery
  tagPickerAndSettings: 'tags',
  selectEditors: 'opts',
};
const callerGroups = (a, b) => {
  const memo = new Map();
  return (caller) => {
    const source = CALLER_SOURCES[caller];
    if (!memo.has(source)) memo.set(source, source ? bothSides(tieGroups(a, source), tieGroups(b, source)) : () => null);
    return memo.get(source);
  };
};
const canonCallerSet = (x, groupsFor) => (x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).map((k) => [k, canonCallers(x[k], groupsFor(k))])) : x);
function canonCallers(x, groupOf) {
  if (Array.isArray(x)) {
    const xs = x.map((v) => canonCallers(v, groupOf));
    if (xs.length < 2) return xs;
    return runsSorted(xs, (el) => {
      const id = rowId(el);
      return id === undefined ? null : (groupOf(id) ?? null);
    });
  }
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = canonCallers(x[k], groupOf);
    return o;
  }
  return x;
}
// A row's group for caller comparison: the same key on both sides, or none.
const bothSides = (ga, gb) => (id) => {
  const a = ga.get(id);
  return a !== undefined && a !== null && a === gb.get(id) ? a : null;
};

function firstDiff(a, b, p = '$') {
  if (J(a) === J(b)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return { path: p, old: `length ${a.length}`, neu: `length ${b.length}` };
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${p}[${i}]`);
      if (d) return d;
    }
  } else if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const d = firstDiff(a[k], b[k], `${p}.${k}`);
      if (d) return d;
    }
  }
  return { path: p, old: JSON.stringify(a)?.slice(0, 200), neu: JSON.stringify(b)?.slice(0, 200) };
}
// equal | timestamp-format | tie-order | diff. `canon` removes tie order only.
function classify(a, b, canon = (x) => x) {
  if (J(a) === J(b)) return 'equal';
  if (JT(a) === JT(b)) return 'timestamp-format';
  if (JT(canon(a)) === JT(canon(b))) return 'tie-order';
  return 'diff';
}
// The part of an error a caller can see. `retry` is the query client's own
// decision, computed in the page with the app's predicate (lib/queries/client.ts).
function errorView(e) {
  if (!e) return null;
  if (!e.retry) throw new Error(`error without the page's retry decision: ${JSON.stringify(e)}`);
  if (typeof e.fullMessage !== 'string') throw new Error(`error without the page's whole message: ${JSON.stringify(e)}`);
  return e;
}

// --------------------------------------------------------------- results ----
const OLD_COMMIT = E.OLD_COMMIT ?? 'a03c481f726';
const R = {
  config: { ...CONFIG },
  commit: git('rev-parse', 'HEAD'),
  // The code under test is the web PR's head; the harness commit only adds this directory.
  prHead: E.PR_HEAD ?? '51cc987139b',
  identicalToPrHeadOutsideProof: git('diff', '--quiet', E.PR_HEAD ?? '51cc987139b', 'HEAD', '--', '.', ':(exclude)apps/web/src/proof') !== null,
  dssBinaryBuiltAt: (() => {
    try {
      return fs.statSync(path.join(ROOT, 'target/debug/document_storage_service')).mtime.toISOString();
    } catch {
      return null;
    }
  })(),
  oldModulesFrom: OLD_COMMIT,
  // Every page load checks which query modules the page runs (OLD: the base
  // commit's copies, NEW: the head's); a mismatch ends the run.
  moduleChecks: { old: 0, neu: 0 },
  startedAt: new Date().toISOString(),
  counts: { sequences: 0, steps: 0, volumeSteps: 0, rawCases: 0, readerComparisons: 0, callerComparisons: 0, imperativeReads: 0, reloads: 0, freshMounts: 0 },
  totals: { differences: 0, harnessErrors: 0 }, // uncapped; diffs and harnessErrors below are samples
  classes: {}, // level -> class -> n
  coverage: {},
  ops: {},
  rejections: {},
  traffic: {},
  otherWrites: {}, // side:tapMode -> route -> n, writes outside the properties service
  pageErrors: {}, // side -> masked message -> n
  sqlFailures: 0,
  collation: null,
  settle: { samples: 0, maxMs: 0, timeouts: 0, buckets: {}, fresh: { samples: 0, maxMs: 0, timeouts: 0 } },
  staleness: { byOp: {}, mismatches: 0 },
  visibility: { checks: 0, oldMissing: 0, newMissing: 0, readFailures: 0 },
  harnessErrors: [],
  settleTimeouts: [], // every settle timeout, whole (first 1,000)
  diffs: [], // first 400 real differences with context
  diffSignatures: {}, // signature -> count
  examples: {}, // class -> first few examples
  mutant: CONFIG.mutant ? { name: CONFIG.mutant, applied: 0, caughtBy: {}, firstCatch: null, ignoredAsInBaseline: 0, beforeApplied: 0, candidate: {}, candidatesBy: {}, tainted: {}, running: {}, marks: [], clock: 0, discardedCatches: 0, taintedSequences: 0 } : null,
  load: CONFIG.load ? { pages: CONFIG.load, ops: 0, errors: 0, sameUserReads: 0, sameUserErrors: 0 } : null,
  crashes: [],
};
// The clean run a mutant is measured against: its difference signatures do
// not count as a catch.
const BASELINE_RESULT = E.BASELINE ? JSON.parse(fs.readFileSync(E.BASELINE, 'utf8')) : null;
// A baseline that failed or never finished has not reached every signature a
// clean run has, so a mutant measured against it could be credited with one.
if (BASELINE_RESULT && !BASELINE_RESULT.verdict?.passed) throw new Error(`baseline ${E.BASELINE} did not pass: ${JSON.stringify(BASELINE_RESULT.verdict ?? 'no verdict')}`);
// ...and one of another shape, commit or with a fault of its own measures something else.
const BASELINE_SHAPE = ['base', 'seed', 'seqs', 'steps', 'lanes', 'rotate', 'readsPerStep', 'sweep', 'volume', 'load', 'control', 'settleMs'];
if (BASELINE_RESULT) {
  const off = BASELINE_SHAPE.filter((k) => J(BASELINE_RESULT.config?.[k]) !== J(CONFIG[k]));
  if (BASELINE_RESULT.config?.mutant) off.push('mutant');
  if (BASELINE_RESULT.commit !== git('rev-parse', 'HEAD')) off.push('commit');
  if (BASELINE_RESULT.oldModulesFrom !== OLD_COMMIT) off.push('old modules commit');
  if (off.length) throw new Error(`baseline ${E.BASELINE} differs from this run in ${off.join(', ')}`);
}
const BASELINE = new Set(BASELINE_RESULT ? Object.keys(BASELINE_RESULT.diffSignatures) : []);
if (CONFIG.mutant && !E.BASELINE) log('warning: no BASELINE; every difference counts as a catch');
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const bump = (obj, ...keys) => {
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys[keys.length - 1];
  o[last] = (o[last] ?? 0) + 1;
};
const cover = (dim, value) => bump(R.coverage, dim, String(value));
function sizeBucket(n) {
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n <= 10) return '2-10';
  if (n <= 100) return '11-100';
  if (n <= 1000) return '101-1000';
  return '>1000';
}
// Each lane (and the volume phase) runs in its own context, so concurrent
// lanes never label each other's comparisons.
const lanes = new AsyncLocalStorage();
const here = () => lanes.getStore() ?? {};
const setCtx = (fields) => {
  const c = here();
  for (const k of Object.keys(c)) delete c[k];
  Object.assign(c, fields);
};
const sig = (level, cls, kind, d, extra) =>
  `${level}|${cls}|${kind.replace(/[0-9a-f-]{36}/g, '<id>')}|${(d?.path ?? '').replace(/\[\d+\]/g, '[]')}${extra.errorPair ? `|${extra.errorPair}` : ''}`;
// Levels that report on the harness and the run rather than on data the app
// read or showed: a timeout, a write outside the tap, an uncaught page error.
// They are still differences, but never count as catching a mutant.
const NOT_A_CATCH = new Set(['settle', 'write-replay', 'page-errors']);
// Where each planted fault can show. The response mutants rewrite NEW's
// GraphQL read responses, so any read of them; the cache mutants change what
// NEW's live query cache holds, so only live readers, never a direct read,
// a fresh mount, or the callers and staleness derived from them.
const anyRead = () => true;
const liveCache = (level) => /:live$/.test(level);
const MUTANT_REACH = {
  'drop-row': anyRead,
  'swap-order': anyRead,
  'alter-field': anyRead,
  'stale-cache': liveCache,
  'skip-live-update': liveCache,
};
// Whether a difference is about data rather than a failure on one side: a
// reader that succeeded on both; a caller that rendered on both, over a
// source list that read without error on both; a snapshot with all of that.
const readerOk = (r) => r?.isSuccess === true && !r.isError && !r.isPlaceholderData;
const threw = (x) => !!x && typeof x === 'object' && 'thrown' in x;
function callerOk(snap, caller) {
  const source = CALLER_SOURCES[caller];
  const src = snap?.callers?.__sources;
  if (!source || !src || threw(snap.callers[caller])) return false;
  if (source === 'opts') return Object.entries(snap).every(([k, r]) => readerKind(k) !== 'opts' || readerOk(r));
  return src[source] !== null && src[source] !== undefined && src.failing?.[source] === false && src.placeholder?.[source] === false;
}
const snapshotClean = (s, expected = []) => !!s && 'callers' in s && expected.every((k) => k in s) && Object.entries(s).every(([k, v]) => (k === 'callers' ? !!v && Object.keys(v).every((c) => c === '__sources' || callerOk(s, c)) : readerOk(v)));
function record(level, kind, cls, a, b, extra = {}, canon = (x) => x) {
  bump(R.classes, level, cls);
  if (cls === 'equal') return;
  const ex = (R.examples[`${level}:${cls}`] ??= []);
  // The first difference that survives normalization (timestamps, tie order).
  const norm = (x) => (x === undefined ? null : JSON.parse(JT(canon(x))));
  const d = cls === 'diff' || cls === 'state' ? firstDiff(norm(a), norm(b)) : firstDiff(a, b);
  const at = { ...here() };
  if (ex.length < 5) ex.push({ kind, ...at, ...extra, diff: d });
  if (level === 'settle' && R.settleTimeouts.length < 1000) R.settleTimeouts.push({ kind, ...at, ...extra, diff: d });
  let shown = null;
  if (cls === 'diff' || cls === 'error-shape' || cls === 'state') {
    const s = sig(level, cls, kind, d, extra);
    bump(R.diffSignatures, s);
    R.totals.differences++;
    if (R.diffs.length < 400) R.diffs.push({ level, kind, class: cls, ...at, ...extra, diff: d });
    if (R.mutant && cls === 'diff' && extra.clean && MUTANT_REACH[R.mutant.name](level) && R.mutant.running[laneOf(at)] && (shown = marked(level, kind, norm(a), norm(b), extra, norm, b === undefined ? null : b))) {
      // A catch is a difference in data both sides read successfully, at a
      // level the planted fault can reach, that the clean run does not have,
      // after the fault was applied at least once.
      if (R.mutant.applied === 0) R.mutant.beforeApplied++;
      else if (BASELINE.has(s)) R.mutant.ignoredAsInBaseline++;
      else {
        bump(R.mutant.candidatesBy, level);
        R.mutant.candidate[laneOf(at)] ??= { level, kind, signature: s, appliedBefore: R.mutant.applied, mark: shown, ...at, diff: d };
      }
    }
    if (R.mutant && NOT_A_CATCH.has(level)) R.mutant.tainted[laneOf(at)] = true;
  }
}
const laneOf = (at) => String(at.lane ?? 'none');
// The account a page belongs to (`L0A-neu` -> `L0A`). A mutant marks the
// account whose NEW page it changed; a catch must be an observation of that
// account, in the same sequence, after the change.
const acctKey = (label) => String(label).replace(/-(old|neu)$/, '');
// Each application of the fault leaves a mark: the account, the order it
// happened in, and what it changed (a row's id, the two swapped rows, or the
// open readers a cache fault left stale). A catch must show that change: the
// dropped row on OLD only, the two rows in opposite order, the altered row
// different, or a marked reader differing live or stale on NEW only.
const laneNum = (label) => String(label).match(/^L(\d+)[AB]-/)?.[1] ?? null;
function mark(label, m) {
  R.mutant.marks.push({ ...m, lane: laneNum(label), account: acctKey(label), clock: ++R.mutant.clock });
}
const clockNow = () => R.mutant?.clock ?? 0;
function walkRows(x, f) {
  if (Array.isArray(x)) x.forEach((v) => walkRows(v, f));
  else if (x && typeof x === 'object') {
    if (typeof x.id === 'string') f(x);
    Object.values(x).forEach((v) => walkRows(v, f));
  }
}
const rowsWith = (x, id) => {
  const out = [];
  walkRows(x, (r) => r.id === id && out.push(r));
  return out;
};
// Every list in x that holds both rows: its row ids in order, by its path.
function listsWith(x, p, q, path = '$', out = new Map()) {
  if (Array.isArray(x)) {
    const ids = x.map(rowId);
    if (ids.includes(p) && ids.includes(q)) out.set(path, ids);
    // a row's own id names its place, so a list keeps its path when rows before it differ
    x.forEach((v, n) => listsWith(v, p, q, `${path}[${rowId(v) ?? n}]`, out));
  } else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) listsWith(v, p, q, `${path}.${k}`, out);
  return out;
}
// One list (same path) that is, on NEW, exactly OLD's list with the two rows
// transposed: every other row in the same place, both sides normalized alike.
// Any other permutation, or another difference in that list, does not match.
function swappedAt(a, b, m) {
  const [p, q] = m.ids;
  const la = listsWith(a, p, q);
  return [...listsWith(b, p, q)].some(([path, idsB]) => {
    const idsA = la.get(path);
    if (!idsA || idsA.indexOf(p) <= idsA.indexOf(q)) return false;
    const undone = idsB.map((id) => (id === p ? q : id === q ? p : id));
    return J(undone) === J(idsA);
  });
}
// A GraphQL field and the reader's or caller's spelling of it (displayOrder,
// display_order; the property panel's domain row calls data_type valueType,
// toPropertyDefinitionDomain in features/property/utils/transforms.ts).
const FIELD_ALIASES = { datatype: 'valuetype' };
const fieldKey = (f) => {
  const k = f.replace(/_/g, '').toLowerCase();
  return FIELD_ALIASES[k] ?? k;
};
const sameField = (a, b) => fieldKey(a) === fieldKey(b);
const fieldOf = (row, field) => Object.entries(row).filter(([k]) => sameField(k, field)).map(([, v]) => J(v));
function shows(m, level, kind, a, b, norm, rawB) {
  if (m.kind === 'drop-row') return rowsWith(a, m.id).length > 0 && rowsWith(b, m.id).length === 0;
  // the two rows in the injected order on NEW and the server's on OLD
  if (m.kind === 'swap-order') return swappedAt(a, b, m);
  // the altered field holding the injected value on NEW and the server's on OLD
  if (m.kind === 'alter-field')
    return rowsWith(b, m.id).some((r) => fieldOf(r, m.field).includes(J(m.to))) && rowsWith(a, m.id).some((r) => fieldOf(r, m.field).includes(J(m.from)));
  // cache faults: a marked live NEW reader still holding exactly, unnormalized,
  // the data the fault left in the cache (the restored copy, or what a
  // swallowed invalidation would have refreshed), and stale: a cold mount of
  // the same reader on the same page this step reads otherwise, successfully,
  // and exactly as OLD reads live: the whole live difference is NEW's stale
  // copy. A refresh that replaced the fault's data, even with rows only
  // reordered, retires it.
  if (/:live$/.test(level))
    return m.readers.some((r) => {
      if (kind !== `reader${r.id}.data` || J(rawB) !== J(r.data)) return false;
      const cold = R.mutant.freshNew?.[r.id];
      return !!cold && readerOk(cold) && J(norm(cold.data)) !== J(b) && J(norm(cold.data)) === J(a);
    });
  return false;
}
function marked(level, kind, a, b, extra, norm, rawB) {
  return R.mutant.marks.find((m) => m.account === extra.account && m.clock <= (extra.asOf ?? -1) && shows(m, level, kind, a, b, norm, rawB)) ?? null;
}
// A sequence's first catch stands only if the sequence had no harness-level
// difference: a replay failure, a timeout or a page error can leave the two
// sides' caches apart and so make differences of its own. Each sequence ends
// with a reload, so what it left behind does not reach the next one.
function settleCatch(lane) {
  if (!R.mutant) return;
  const k = String(lane ?? 'none');
  delete R.mutant.running[k];
  const c = R.mutant.candidate[k];
  if (c && R.mutant.tainted[k]) R.mutant.discardedCatches++;
  else if (c && !R.mutant.firstCatch) R.mutant.firstCatch = c;
  if (c && !R.mutant.tainted[k]) bump(R.mutant.caughtBy, c.level);
  if (R.mutant.tainted[k]) R.mutant.taintedSequences++;
  delete R.mutant.candidate[k];
  delete R.mutant.tainted[k];
}
// Page errors arrive on the page's own callback, outside any lane: one seen
// while a sequence runs taints every sequence then running.
function pageErrorTaint() {
  if (!R.mutant) return;
  for (const k of Object.keys(R.mutant.running)) R.mutant.tainted[k] = true;
}
// A failure of the harness itself (setup, a write the tap could not pair):
// counted, sampled, and never mistaken for an equal comparison.
function harnessError(msg) {
  R.totals.harnessErrors++;
  if (R.harnessErrors.length < 200) R.harnessErrors.push(msg);
}

// --------------------------------------------------------------- browser ----
const browser = await chromium.launch({
  channel: 'chromium',
  headless: CONFIG.headless,
  args: ['--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights'],
});
const ONBOARDED = { status: 'completed', skipped: true, started_at: new Date().toISOString(), completed_at: new Date().toISOString() };
async function baseRoutes(ctx) {
  await ctx.route((u) => u.toString().startsWith(`${ORIGIN}/`) && !/\/src\/|\/node_modules\/|\/@/.test(new URL(u.toString()).pathname), async (r) => {
    try {
      await r.fulfill({ response: await r.fetch({ maxRedirects: 0 }) });
    } catch {
      await r.abort().catch(() => {});
    }
  });
  await ctx.route((u) => /\/cognition\/onboarding(\/complete)?$/.test(u.toString()), (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(r.request().url().endsWith('complete') ? ONBOARDED : { row: ONBOARDED, connected_servers: [], suggested_team_domain: null }) })
  );
}
const CTX_OPTS = { ignoreHTTPSErrors: true, viewport: { width: 1024, height: 700 }, serviceWorkers: 'block' };

// The auth service counts sign-ups per client address an hour in Redis
// (crates/macro_cache_client/src/create_user_rate_limit.rs). Only this
// stack instance's own Redis is touched.
function clearSignUpCounter() {
  if (!CONFIG.redis) return false;
  try {
    const keys = execFileSync('docker', ['exec', CONFIG.redis, 'redis-cli', '--raw', 'KEYS', 'rtl_create_user_hourly:*'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    if (keys.length) execFileSync('docker', ['exec', CONFIG.redis, 'redis-cli', 'DEL', ...keys], { encoding: 'utf8' });
    R.signUpCountersCleared = (R.signUpCountersCleared ?? 0) + 1;
    return true;
  } catch (e) {
    harnessError(`clearing the sign-up counter: ${firstLine(e)}`);
    return false;
  }
}
async function login(email) {
  const ctx = await browser.newContext(CTX_OPTS);
  await baseRoutes(ctx);
  const page = await ctx.newPage();
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${CONFIG.base}/app/`, { waitUntil: 'load', timeout: 180000 });
      // a page the dev server served without its modules stays blank: load it again
      await page.getByText('Continue with email').first().click({ timeout: 60000 });
      await page.getByPlaceholder(/company\.com$/).fill(email);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const outcome = await Promise.race([
        page.waitForURL(/\/app\/(home|onboarding|component|welcome\/)/, { timeout: 90000 }).then(() => 'in', () => 'timeout'),
        page.getByText('unable to create user').waitFor({ timeout: 90000 }).then(() => 'refused', () => 'timeout'),
      ]);
      if (outcome === 'in') break;
      if (outcome === 'timeout') throw new Error('Timeout: no sign-in after 90 s');
      // Signup rate limit: clear this instance's counter, as the email e2e
      // tier does (tests/email-e2e/harness/sign-up-limit.ts); with no Redis
      // container to clear, wait for the hour to roll over.
      R.loginWaits = (R.loginWaits ?? 0) + 1;
      if (attempt >= 20) throw new Error(`signup still refused after ${attempt} waits`);
      if (clearSignUpCounter()) log(`signup refused for ${email.split('@')[0]} (rate limit); cleared the instance's sign-up counter`);
      else {
        log(`signup refused for ${email.split('@')[0]} (rate limit); waiting 5 min`);
        await sleep(300000);
      }
    } catch (e) {
      if (attempt >= 20 || !/Timeout/.test(String(e.message))) throw e;
      // what the page showed instead, for the log (synthetic account pages only)
      const shown = await page.evaluate(() => `${location.pathname} ${document.body?.innerText.slice(0, 80).replace(/\s+/g, ' ')}`).catch(() => '?');
      log(`login retry ${email.split('@')[0]}: ${String(e.message).slice(0, 80)}; page: ${shown}`);
    }
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

const HARNESS = `${CONFIG.base}/src/proof/property-catalog/index.html`;
const OLD_MODULE = /\/src\/lib\/queries\/properties\/(definitions|options|tags)\.ts(\?.*)?$/;
// The properties service, on any host: behind the local proxy
// (`/dss/properties/...`) or on a direct DSS port (`/properties/...`).
const PROPS_PATH = /(^|\/)properties(\/|$)/;
const isWrite = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method());
// A GraphQL request that writes (the catalog's writes are all REST).
// Comments are stripped first, every operation of a batch counts, and a body
// with no query text (a persisted query) counts as a write unless it names a
// catalog read.
const isGraphqlMutation = (req) => {
  // A GET (the app's cached reads) or an empty POST carries no operation.
  if (!isWrite(req)) return false;
  let body;
  try {
    body = req.postDataJSON();
  } catch {
    return false;
  }
  if (body === null || body === undefined) return false;
  return (Array.isArray(body) ? body : [body]).some((b) => {
    if (typeof b?.query !== 'string') return !String(b?.operationName ?? '').startsWith('PropertyCatalog');
    return /(^|[\s}])(mutation|subscription)\b/.test(b.query.replace(/#[^\n\r]*/g, ' '));
  });
};
// Writes the page sends outside the properties service and GraphQL, by side,
// tap mode and route (ids masked): a census, and in a write window a stray.
const maskPath = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\/\d+(?=\/|$)/g, '/<n>');
// Writes either page sends that never touch the catalog, seen in a smoke run:
// the session token refresh, which the auth client sends on its own clock.
// Still counted in `otherWrites`; never a stray.
const IGNORED_WRITE = /^POST [^ ]+\/auth\/jwt\/refresh$/;

// One side (OLD or NEW) of one account: its own browser context and page.
async function openSide(storageState, side, label) {
  const bctx = await browser.newContext({ ...CTX_OPTS, storageState });
  await baseRoutes(bctx);
  // mode: pass (no write expected), setup (the runner's own NEW writes),
  // record (NEW, in a write window), replay (OLD, in a write window)
  const tap = { mode: 'pass', rec: [], queue: [], mismatches: [], stray: [], mutantArmed: false };
  const sameUserLoad = CONFIG.load > 0 && side === 'neu' && /^L\d/.test(label);
  if (sameUserLoad)
    await bctx.exposeBinding('__sameUserTick', (_src, ok) => {
      R.load.sameUserReads++;
      if (!ok) R.load.sameUserErrors++;
    });
  const old = side === 'old' || CONFIG.control;
  if (old)
    await bctx.route(OLD_MODULE, async (r) => {
      const u = new URL(r.request().url());
      u.pathname = u.pathname.replace(/\.ts$/, '.__old__.ts');
      // A failed module fetch fails the page load, which loadHarness retries; it
      // must never fall back to the head's module on the OLD side.
      const resp = await r.fetch({ url: u.toString(), maxRedirects: 0 }).catch((e) => (harnessError(`${label}: old module ${u.pathname}: ${firstLine(e)}`), null));
      if (!resp || resp.status() !== 200) return r.abort('failed');
      await r.fulfill({ response: resp });
    });
  // Writes to the properties service: recorded on NEW, replayed on OLD, so
  // each write reaches the server once and both sides see the same answer.
  // The runner checks after each write that the replay matched one for one.
  await bctx.route((u) => PROPS_PATH.test(new URL(u.toString()).pathname), async (r) => {
    const req = r.request();
    if (!isWrite(req)) return r.fallback();
    const u = new URL(req.url());
    // The origin is part of a write's identity: a replay to another host is a mismatch.
    const entry = { method: req.method(), path: u.origin + u.pathname + u.search, body: req.postData() ?? null };
    // setup: the runner's own writes (accounts, volume, load), NEW pages only.
    if (tap.mode === 'setup' && side === 'neu') return r.fallback();
    if (tap.mode === 'pass' || tap.mode === 'setup') {
      // No write is expected here: the OLD side never writes on its own, and a
      // NEW write outside a write window (a late retry) bypasses the replay.
      // Either is held as a stray and recorded as a difference.
      tap.stray.push({ ...entry, mode: tap.mode });
      if (side === 'old') return r.fulfill({ status: 599, body: 'harness: OLD side wrote outside a replay' });
      return r.fallback();
    }
    if (tap.mode === 'record') {
      // A write the dev server never answered fails on both sides alike.
      const resp = await r.fetch().catch((e) => (harnessError(`${label}: write ${entry.method} ${u.pathname}: ${firstLine(e)}`), null));
      if (!resp) {
        tap.rec.push({ ...entry, failed: true });
        return r.abort('failed');
      }
      const body = await resp.text();
      const headers = { ...resp.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      tap.rec.push({ ...entry, status: resp.status(), headers, resp: body });
      return r.fulfill({ status: resp.status(), headers, body });
    }
    const next = tap.queue.shift();
    if (!next || next.method !== entry.method || next.path !== entry.path || next.body !== entry.body) {
      tap.mismatches.push({ expected: next && { method: next.method, path: next.path, body: next.body }, got: entry });
      return r.fulfill({ status: 599, body: 'harness: unexpected write' });
    }
    if (next.failed) return r.abort('failed');
    return r.fulfill({ status: next.status, headers: next.headers, body: next.resp });
  });
  if (side === 'neu' && ['drop-row', 'swap-order', 'alter-field'].includes(CONFIG.mutant)) {
    const g = rng(CONFIG.seed * 7919 + label.length);
    await bctx.route(/\/graphql/, async (r) => {
      const req = r.request();
      let op = null;
      try {
        op = req.postDataJSON()?.operationName ?? null;
      } catch {}
      if (!op?.startsWith('PropertyCatalog') || !tap.mutantArmed || !g.chance(CONFIG.mutantRate)) return r.fallback();
      const resp = await r.fetch().catch((e) => (harnessError(`${label}: mutant fetch: ${firstLine(e)}`), null));
      if (!resp) return r.abort('failed');
      const json = await resp.json();
      const m = mutateResponse(json, CONFIG.mutant, g);
      const headers = { ...resp.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      await r.fulfill({ status: resp.status(), headers, body: JSON.stringify(json) });
      // marked once delivered, so no observation taken before it can match
      if (m) {
        R.mutant.applied++;
        mark(label, m);
      }
    });
  }
  // Which transport each page reads through. Raw read cases and the generator
  // call both clients from the NEW page, so NEW's REST count includes those;
  // the module check, not this count, shows which code each side runs.
  bctx.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    const role = old ? 'old side' : 'new side';
    if (PROPS_PATH.test(p) && !isWrite(req)) bump(R.traffic, role, 'REST GET /properties');
    else if (/graphql/.test(p)) {
      let op = null;
      try {
        op = req.postDataJSON()?.operationName ?? null;
      } catch {}
      if (op?.startsWith('PropertyCatalog')) bump(R.traffic, role, `GraphQL ${op}`);
      // A GraphQL write bypasses the tap: from OLD at any time, from NEW
      // outside the runner's setup.
      if (isGraphqlMutation(req)) {
        bump(R.otherWrites, `${side}:${tap.mode}`, `GraphQL ${req.method()} ${op ?? '(unnamed)'}`);
        if (side === 'old' || tap.mode !== 'setup') tap.stray.push({ method: 'POST', path: p, body: op, mode: tap.mode });
      }
    } else if (isWrite(req) && !PROPS_PATH.test(p)) {
      const u = new URL(req.url());
      const route = `${req.method()} ${u.host}${maskPath(p)}`;
      bump(R.otherWrites, `${side}:${tap.mode}`, route);
      if (!IGNORED_WRITE.test(route) && (tap.mode === 'record' || tap.mode === 'replay' || side === 'old')) tap.stray.push({ method: req.method(), path: route, body: null, mode: tap.mode });
    }
  });
  const page = await bctx.newPage();
  // Uncaught page errors, by side and message: one seen on one side only is a
  // difference (checked at the end of the run).
  page.on('pageerror', (e) => {
    const msg = String(e.message).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').slice(0, 200);
    if (!/^load\d/.test(label)) bump(R.pageErrors, side, msg);
    harnessError(`${label}: pageerror ${msg}`);
    pageErrorTaint();
  });
  // Module loads that failed or errored, for diagnosing a page that never got ready.
  const note = (x) => {
    s.netlog ??= [];
    s.netlog.push(x);
    if (s.netlog.length > 40) s.netlog.shift();
  };
  page.on('requestfailed', (r) => note(`failed ${new URL(r.url()).pathname.slice(0, 90)} ${r.failure()?.errorText}`));
  // API requests in flight, so a settle timeout can say what it waited on.
  const inflight = new Map();
  const isModule = (r) => /^\/(src|node_modules|@)/.test(new URL(r.url()).pathname);
  page.on('request', (r) => !isModule(r) && inflight.set(r, { method: r.method(), path: maskPath(new URL(r.url()).pathname), at: Date.now() }));
  // API requests that finished lately, with their status and duration, so a
  // settle timeout shows how long the attempts before the one in flight took.
  const finished = [];
  page.on('requestfinished', async (r) => {
    const x = inflight.get(r);
    inflight.delete(r);
    if (!x) return;
    const status = await r.response().then((res) => res?.status() ?? null, () => null);
    finished.push({ ...x, status, ms: Date.now() - x.at, end: Date.now() });
    if (finished.length > 30) finished.shift();
  });
  page.on('requestfailed', (r) => inflight.delete(r));
  page.on('response', (r) => r.status() >= 400 && /\/(src|node_modules|@)/.test(r.url()) && note(`${r.status()} ${new URL(r.url()).pathname.slice(0, 90)}`));
  page.on('console', (m) => m.type() === 'error' && !/Vite server|Failed to load resource/.test(m.text()) && note(`console ${m.text().slice(0, 120)}`));
  const s = { ctx: bctx, page, tap, side, label, old, sameUserLoad, inflight, finished };
  await loadHarness(s);
  return s;
}
// Load (or reload) the harness page. Chromium aborts the module requests in
// flight whenever the machine's network interfaces change (another stack's
// containers coming and going), and one failed module fails the page's whole
// module graph; that load is retried and recorded, never compared.
const LOAD_ATTEMPTS = 8;
// Ready, or a module request already failed: a page that lost a module never
// becomes ready, so it is reloaded at once instead of after the timeout.
async function waitReady(s) {
  const bound = Number(E.READY_MS ?? 120000);
  const deadline = Date.now() + bound;
  for (;;) {
    const ready = await s.page.evaluate(() => !!(window.__harnessReady && window.__h.authenticated() === true)).catch(() => false);
    if (ready) return;
    const dead = s.netlog.find((x) => /^(failed |[45]\d\d )\/(src|node_modules|@)/.test(x));
    if (dead) throw new Error(`module request failed: ${dead}`);
    if (Date.now() > deadline) throw new Error(`page.waitForFunction: Timeout ${bound}ms exceeded.`);
    await sleep(250);
  }
}
// Every load then checks which query modules the page runs.
async function loadHarness(s) {
  for (let attempt = 1; ; attempt++) {
    s.netlog = [];
    try {
      await s.page.goto(HARNESS, { waitUntil: 'load', timeout: 300000 });
      await waitReady(s);
      break;
    } catch (e) {
      const st = await s.page.evaluate(() => ({ ready: !!window.__harnessReady, auth: window.__h?.authenticated?.(), url: location.href, body: document.body.innerText.slice(0, 200) })).catch((x) => String(x));
      const msg = `${s.label}: harness not ready (attempt ${attempt}) ${JSON.stringify(st)}: ${e.message.slice(0, 100)}; last requests: ${JSON.stringify(s.netlog.slice(-8))}`;
      harnessError(msg);
      if (attempt >= LOAD_ATTEMPTS) throw new Error(msg);
      log(msg.slice(0, 300));
      await sleep(2000 * attempt);
      R.harnessReloadRetries = (R.harnessReloadRetries ?? 0) + 1;
    }
  }
  const sides = await ev(s, 'moduleSides');
  const want = s.old ? `old:${OLD_COMMIT}` : 'head';
  const wrong = Object.entries(sides).filter(([, v]) => v !== want);
  if (wrong.length) throw new Error(`${s.label}: page runs the wrong query modules: ${JSON.stringify(sides)}, want ${want}`);
  // By physical side: in CONTROL both sides run the base commit's modules.
  R.moduleChecks[s.side]++;
  if (s.side === 'neu' && CONFIG.mutant === 'skip-live-update') await ev(s, 'mutant.skipLiveUpdate');
  if (s.sameUserLoad) await startSameUserLoad(s);
}
// The first line of an error: Playwright appends the request log, cookies included.
function firstLine(e) {
  return String(e?.message ?? e).split('\n')[0].slice(0, 200);
}
// The runner's own setup writes (`setup.*`) run in the tap's setup mode, so
// the tap tells them apart from a write the page sends by itself.
async function ev(s, fnPath, ...args) {
  const setup = fnPath.startsWith('setup.');
  const before = s.tap.mode;
  if (setup) s.tap.mode = 'setup';
  try {
    return await s.page.evaluate(
      ([p, a]) => {
        const f = p.split('.').reduce((o, k) => o[k], window.__h);
        return f(...a);
      },
      [fnPath, args]
    );
  } finally {
    if (setup) s.tap.mode = before;
  }
}

// Mutants for the response path: break the GraphQL answer the new code reads.
function mutateResponse(json, kind, g) {
  const user = json?.data?.user;
  if (!user) return null;
  const lists = [];
  if (Array.isArray(user.propertyDefinitions)) lists.push(user.propertyDefinitions);
  if (Array.isArray(user.propertyOptions)) lists.push(user.propertyOptions);
  for (const d of user.propertyDefinitions ?? []) if (Array.isArray(d?.options)) lists.push(d.options);
  for (const s of user.tagSets ?? []) if (Array.isArray(s?.options)) lists.push(s.options);
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (!nonEmpty.length) return null;
  const list = g.pick(nonEmpty);
  if (kind === 'drop-row') {
    const [row] = list.splice(g.int(list.length), 1);
    return { kind, id: row?.id };
  }
  if (kind === 'swap-order') {
    const sig = (x) => J(Object.fromEntries(Object.entries(x).filter(([k]) => !['id', '__typename', 'createdAt', 'updatedAt'].includes(k))));
    for (let i = 0; i < list.length; i++)
      for (let j = list.length - 1; j > i; j--)
        if (sig(list[i]) !== sig(list[j])) {
          [list[i], list[j]] = [list[j], list[i]];
          // NEW now lists ids[0] where the server listed ids[1], and the reverse
          return { kind, ids: [list[i].id, list[j].id] };
        }
    return null;
  }
  if (kind === 'alter-field') {
    const row = g.pick(list);
    const fields = Object.entries(row).filter(([k, v]) => !['id', '__typename'].includes(k) && (typeof v === 'string' || typeof v === 'number' || v === null));
    if (!fields.length) return null;
    const [k, v] = g.pick(fields);
    row[k] = typeof v === 'number' ? v + 1 : typeof v === 'string' && !ISO_TS.test(v) ? `${v}·` : v === null ? '#010203' : v;
    return row[k] !== v ? { kind, id: row.id, field: k, from: v, to: row[k] } : null;
  }
  return null;
}

// ------------------------------------------------------------ comparisons ----
const STATE_FIELDS = ['status', 'fetchStatus', 'isPending', 'isSuccess', 'isError', 'isFetched', 'isPlaceholderData', 'isLoading', 'isStale', 'isRefetching', 'isRefetchError', 'isLoadingError', 'failureCount'];
const errorLabel = (e) => (e ? `${e.class}/${JSON.stringify(e.codes)}/${e.httpStatus}/${JSON.stringify(e.graphqlCodes)}/${e.retry}/${JSON.stringify(e.message)}` : 'none');
// Errors are always compared, whatever the data did. A different error with
// the same retry decision is error-shape (each old=>new pair its own
// signature); one side failing alone, or a different retry decision, is a diff.
// Equality reads the whole message as it is. The signature carries both
// sides' whole messages with ids masked, and whether the ids they name are
// the same, so a pair that differs in what it says or which ids it names is a
// signature of its own, closed on its own.
// Ids in the pair's two messages are numbered by first appearance across
// both, so the signature keeps which id fills which role on each side
// (`<id1> on <id2>` vs `<id2> on <id1>`) without the ids themselves.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// The message's own `\` and `<` are escaped first, so literal text can
// never read as an id token.
function pairLabel(A, B) {
  const n = new Map();
  const num = (u) => n.get(u.toLowerCase()) ?? (n.set(u.toLowerCase(), n.size + 1), n.size);
  const mask = (e) =>
    e && {
      ...e,
      message: String(e.fullMessage)
        .replace(/[\\<]/g, (c) => `\\${c}`)
        .replace(UUID, (u) => `<id${num(u)}>`),
    };
  const a = mask(A);
  const b = mask(B);
  return `${errorLabel(a)}=>${errorLabel(b)}`;
}
function compareErrors(level, kind, ea, eb, extra = {}) {
  const A = errorView(ea);
  const B = errorView(eb);
  if (J(A) === J(B)) return record(level, `${kind}.error`, 'equal');
  const cls = (A === null) !== (B === null) || A?.retry !== B?.retry ? 'diff' : 'error-shape';
  record(level, `${kind}.error`, cls, A, B, { ...extra, errorPair: pairLabel(A, B) });
}
function compareReader(level, id, a, b, at) {
  R.counts.readerComparisons++;
  const kind = `reader${id}`;
  if (!a || !b) {
    record(level, kind, 'state', a ?? null, b ?? null, { note: 'reader missing on one side or both' });
    return;
  }
  const sa = Object.fromEntries(STATE_FIELDS.map((k) => [k, a[k]]));
  const sb = Object.fromEntries(STATE_FIELDS.map((k) => [k, b[k]]));
  if (J(sa) !== J(sb)) record(level, kind, 'state', sa, sb);
  const canon = canonFor(readerKind(id));
  record(level, `${kind}.data`, classify(a.data, b.data, canon), a.data, b.data, { clean: readerOk(a) && readerOk(b), ...at }, canon);
  compareErrors(level, kind, a.error, b.error);
}
function compareCallers(level, sa, sb, groupsFor, at) {
  const a = sa.callers;
  const b = sb.callers;
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    if (k === '__sources') continue;
    const clean = callerOk(sa, k) && callerOk(sb, k);
    const canon = (x) => canonCallers(x, groupsFor(k));
    R.counts.callerComparisons++;
    record(`${level}:caller`, `caller.${k}`, classify(a?.[k], b?.[k], canon), a?.[k], b?.[k], { clean, ...at }, canon);
  }
}
// `expected`: the reader ids that must be in both snapshots.
function compareSnapshots(level, a, b, expected, at) {
  const groupsFor = callerGroups(a, b);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b), ...expected, 'callers'])) {
    if (k === 'callers') {
      if (!a.callers || !b.callers) record(`${level}:caller`, 'callers', 'state', a.callers ?? null, b.callers ?? null, { note: 'callers missing' });
      else compareCallers(level, a, b, groupsFor, at);
    } else compareReader(level, k, a[k], b[k], at);
  }
}
// Raw read case: the old queryFn and the new reader, back to back.
function compareRaw(kind, k, oldR, newR, account) {
  R.counts.rawCases++;
  const level = `raw:${here().phase ?? 'read'}`;
  if (oldR.ok !== newR.ok) return record(level, kind, 'diff', { ok: oldR.ok, error: oldR.error ?? null, message: oldR.message ?? null }, { ok: newR.ok, error: newR.error ?? null, message: newR.message ?? null });
  if (!oldR.ok) {
    bump(R.coverage, 'raw outcome', 'both errored');
    return compareErrors(level, kind, oldR.error, newR.error, { oldMessage: oldR.message, newMessage: newR.message });
  }
  bump(R.coverage, 'raw outcome', 'both ok');
  const canon = canonFor(k);
  return record(level, kind, classify(oldR.value, newR.value, canon), oldR.value, newR.value, { clean: true, account, asOf: clockNow() }, canon);
}
// In CONTROL both halves of a raw case run the base commit's functions.
const newRaw = (fn) => (CONFIG.control ? `raw.old.${fn}` : `raw.neu.${fn}`);
async function rawCase(s, key) {
  if (key.k === 'defs') {
    cover('listing scope', key.scope);
    cover('listing includeOptions', key.includeOptions);
    cover('listing forEntityType', key.forEntityType ?? 'none');
    const a = { scope: key.scope, includeOptions: key.includeOptions, forEntityType: key.forEntityType };
    const [o, n] = await Promise.all([ev(s, 'raw.old.list', a), ev(s, newRaw('list'), a)]);
    if (o.ok) {
      cover('listing size', sizeBucket(o.value.length));
      coverTies('definitions', o.value, defKey);
    }
    compareRaw(`defs:${key.scope}:${key.includeOptions ? 'opts' : 'plain'}:${key.forEntityType ?? '-'}`, 'defs', o, n, acctKey(s.label));
  } else if (key.k === 'opts') {
    cover('option target', key.why ?? 'visible');
    const [o, n] = await Promise.all([ev(s, 'raw.old.options', key.id), ev(s, newRaw('options'), key.id)]);
    if (o.ok) {
      cover('options size', sizeBucket(o.value.length));
      coverTies('options', o.value, optKey);
    }
    compareRaw(`opts:${key.why ?? 'visible'}`, 'opts', o, n, acctKey(s.label));
  } else {
    const [o, n] = await Promise.all([ev(s, 'raw.old.tags'), ev(s, newRaw('tags'))]);
    if (o.ok) {
      cover('tag count', sizeBucket(o.value.reduce((t, set) => t + set.options.length, 0)));
      for (const set of o.value) coverTies('tag options', set.options, optKey);
    }
    compareRaw('tags', 'tags', o, n, acctKey(s.label));
  }
}
// Rows whose server sort key is shared with a neighbour (the tie-order class
// can only apply to these), and rows the canonicalizer has no key for (which
// it never reorders).
function coverTies(what, list, keyOf) {
  if (!Array.isArray(list)) return;
  const keys = list.map(keyOf);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === null) bump(R.coverage, 'tie keys', `${what}: no key`);
    else if (keys[i] === keys[i - 1] || keys[i] === keys[i + 1]) bump(R.coverage, 'tie keys', `${what}: tied with a neighbour`);
  }
}

// ---------------------------------------------------------------- catalog ----
// What the account can see now, read through the old REST client (the
// generator only needs ids; it never feeds the comparison).
async function catalog(s) {
  const [defs, tags] = await Promise.all([ev(s, 'raw.old.list', { scope: 'all', includeOptions: true }), ev(s, 'raw.old.tags')]);
  const list = defs.ok ? defs.value : [];
  return {
    // a failed listing leaves the generator nothing to pick from; it is not an empty catalog
    listed: defs.ok,
    defs: list,
    own: list.filter((d) => !d.definition.is_system),
    selects: list.filter((d) => ['SELECT_STRING', 'SELECT_NUMBER'].includes(defType(d))),
    ownSelects: list.filter((d) => !d.definition.is_system && ['SELECT_STRING', 'SELECT_NUMBER'].includes(defType(d))),
    tagSets: tags.ok ? tags.value : [],
  };
}
const defType = (d) => (d.definition.data_type?.type ?? d.definition.data_type ?? '').toString().toUpperCase();

// ------------------------------------------------------------------ lanes ----
async function newAccountPair(lane, generation) {
  const tag = `${CONFIG.seed}-${lane}-${generation}-${STAMP}`;
  // A domain per account: a team auto-joins its owner's domain, which must be unique.
  const emailA = `pc-owner-${tag}@owner-${tag}.fuzz.test`;
  const emailB = `pc-member-${tag}@member-${tag}.fuzz.test`;
  const [stA, stB] = await Promise.all([login(emailA), login(emailB)]);
  const A = { name: 'A', old: await openSide(stA, 'old', `L${lane}A-old`), neu: await openSide(stA, 'neu', `L${lane}A-neu`), storage: stA };
  const B = { name: 'B', old: await openSide(stB, 'old', `L${lane}B-old`), neu: await openSide(stB, 'neu', `L${lane}B-neu`), storage: stB };
  const pair = { lane, generation, A, B, inTeam: false, teamCreated: false, everJoined: false, bUserId: null, deleted: [], foreign: [] };
  // B's private user definition: an id A may not read (permission dimension).
  const bPrivate = await ev(B.neu, 'setup.rest', 'createPropertyDefinition', { body: { display_name: `B private ${tag}`, data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'secret' }] }, scope: 'user' } });
  if (bPrivate.ok) pair.foreign.push(bPrivate.value.id ?? bPrivate.value.definition?.id);
  return pair;
}
async function closePair(pair) {
  for (const acct of [pair.A, pair.B]) for (const s of [acct.old, acct.neu]) await s.ctx.close().catch(() => {});
}
const sides = (pair) => [pair.A.old, pair.A.neu, pair.B.old, pair.B.neu];

async function teamCreate(pair, g) {
  const t = await ev(pair.A.neu, 'setup.auth', 'createTeam', { name: `Fuzz team ${pair.lane}-${pair.generation}-${g.int(1e6)}` });
  if (!t.ok) {
    harnessError(`createTeam: ${JSON.stringify(t.error)} ${t.message}`);
    return false;
  }
  pair.teamCreated = true;
  return teamJoin(pair);
}
async function teamJoin(pair) {
  const link = await ev(pair.A.neu, 'setup.auth', 'createTeamInviteLink');
  if (!link.ok) return harnessError(`invite link: ${link.message}`), false;
  const join = await ev(pair.B.neu, 'setup.auth', 'joinTeamByInviteLink', link.value.token);
  if (!join.ok) return harnessError(`join: ${join.message}`), false;
  const team = await ev(pair.A.neu, 'setup.auth', 'getTeam');
  const owner = team.ok ? team.value?.members?.find((m) => m.role === 'owner') : null;
  const member = team.ok ? team.value?.members?.find((m) => m !== owner) : null;
  pair.bUserId = member?.user_id ?? null;
  pair.inTeam = true;
  pair.everJoined = true;
  return true;
}
async function teamRevoke(pair) {
  if (!pair.bUserId) return false;
  const r = await ev(pair.A.neu, 'setup.auth', 'removeUserFromTeam', pair.bUserId);
  if (!r.ok) return harnessError(`remove: ${r.message}`), false;
  pair.inTeam = false;
  return true;
}

// Open readers for a sequence: what screens the user has open.
function chooseKeys(g, cat, pair) {
  const keys = [{ k: 'tags' }];
  for (let i = 0; i < 2 + g.int(5); i++) {
    const lk = g.pick(LIST_KEYS);
    keys.push({ k: 'defs', scope: lk.scope, includeOptions: lk.includeOptions, ...(lk.forEntityType ? { forEntityType: lk.forEntityType } : {}) });
  }
  const pool = [...cat.selects, ...cat.tagSets.filter((t) => t.definition).map((t) => ({ definition: { id: t.definition.id } }))];
  for (let i = 0; i < g.int(4) && pool.length; i++) keys.push({ k: 'opts', id: g.pick(pool).definition.id });
  if (g.chance(0.2) && pair.deleted.length) keys.push({ k: 'opts', id: g.pick(pair.deleted) });
  if (g.chance(0.1)) keys.push({ k: 'opts', id: crypto.randomUUID() });
  const seen = new Set();
  return keys.filter((k) => {
    const id = JSON.stringify(k);
    return seen.has(id) ? false : (seen.add(id), true);
  });
}
async function setKeys(pair, keys) {
  pair.keys = keys;
  await Promise.all(sides(pair).map((s) => ev(s, 'setKeys', keys)));
  for (const k of keys) cover('open reader', k.k === 'defs' ? `defs:${k.scope}` : k.k);
}
// What a side that timed out was still waiting on: its busy queries, its API
// requests in flight (with their age) and its last failed requests.
function withWaitedOn(s, t) {
  if (!t.timedOut) return t;
  const now = Date.now();
  const recent = s.finished
    .filter((x) => now - x.end <= t.ms + 1000)
    .map((x) => ({ method: x.method, path: x.path, status: x.status, startedAgoMs: now - x.at, ms: x.ms }));
  const stalls = driverStalls.filter((x) => now - x.end <= t.ms + 1000).map((x) => ({ endedAgoMs: now - x.end, ms: x.ms }));
  return { ...t, waitedOn: { busy: t.busy ?? null, fetches: t.fetches ?? null, driverStalls: stalls, inflight: [...s.inflight.values()].map((x) => ({ method: x.method, path: x.path, ms: now - x.at })), recent, net: (s.netlog ?? []).slice(-8) } };
}
async function settleAll(pair) {
  // what a side that timed out waited on is sampled as its settle returns
  const res = await Promise.all(sides(pair).map(async (s) => withWaitedOn(s, await ev(s, 'settle', CONFIG.settleMs))));
  // A side that did not settle within the bound broke the live-update bound:
  // a difference, and its snapshot is not compared as data.
  res.forEach((t, i) => {
    if (t.timedOut) record('settle', `${SIDE_NAMES[i]} did not settle within ${CONFIG.settleMs}ms`, 'state', null, { ms: t.ms }, { waitedOn: t.waitedOn });
  });
  for (const t of res) {
    R.settle.samples++;
    R.settle.maxMs = Math.max(R.settle.maxMs, t.ms);
    if (t.timedOut) R.settle.timeouts++;
    bump(R.settle.buckets, t.ms < 250 ? '<250ms' : t.ms < 1000 ? '250ms-1s' : t.ms < 2500 ? '1-2.5s' : '2.5-5s');
  }
  return res.map((t) => t.timedOut);
}
const SIDE_NAMES = ['A old', 'A new', 'B old', 'B new'];
// Writes a side sent outside a write window (OLD on its own, a late NEW
// retry, a GraphQL mutation): each is a difference, checked before any
// window resets the list and at every comparison.
function checkStray(pair) {
  for (const [who, s] of [['A new', pair.A.neu], ['A old', pair.A.old], ['B new', pair.B.neu], ['B old', pair.B.old]]) {
    if (!s.tap.stray.length) continue;
    record('write-replay', `write outside the tap (${who})`, 'diff', [], s.tap.stray.map(({ method, path, mode }) => ({ method, path: path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>'), mode })));
    s.tap.stray = [];
  }
}
// After a step: live (open readers) OLD vs NEW, fresh (a cold load) OLD vs
// NEW, and within each side live vs fresh, whose staleness must match.
async function compareStep(pair, level, op) {
  checkStray(pair);
  const timedOut = await settleAll(pair);
  if (CONFIG.mutant === 'stale-cache') {
    const pages = [pair.A.neu, pair.B.neu];
    const restored = await Promise.all(pages.map((s) => ev(s, 'mutant.restoreCache')));
    if (restored.some((x) => x.restored > 0)) R.mutant.applied++;
    restored.forEach((x, i) => x.restored > 0 && mark(pages[i].label, { kind: 'stale-cache', readers: x.readers }));
  }
  if (CONFIG.mutant === 'skip-live-update') await takeSkipped(pair.A.neu, pair.B.neu);
  const keys = pair.keys;
  const expected = keys.map((k) => JSON.stringify(k));
  // Only a fault applied before a snapshot was taken can show in it.
  const liveAsOf = clockNow();
  const [liveAo, liveAn, liveBo, liveBn] = await Promise.all(sides(pair).map((s) => ev(s, 'snapshot')));
  const fresh = await Promise.all(
    sides(pair).map(async (s) => {
      const f = await ev(s, 'fresh', keys, CONFIG.settleMs);
      return { ...f, timing: withWaitedOn(s, f.timing), asOf: clockNow() };
    })
  );
  R.counts.freshMounts += 4;
  for (const f of fresh) {
    R.settle.fresh.samples++;
    R.settle.fresh.maxMs = Math.max(R.settle.fresh.maxMs, f.timing.ms);
    if (f.timing.timedOut) R.settle.fresh.timeouts++;
  }
  fresh.forEach((f, i) => {
    if (f.timing.timedOut) record('settle', `${SIDE_NAMES[i]} fresh mount did not settle within ${CONFIG.settleMs}ms`, 'state', null, { ms: f.timing.ms }, { waitedOn: f.timing.waitedOn });
  });
  const freshOut = fresh.map((f) => f.timing.timedOut);
  const [frAo, frAn, frBo, frBn] = fresh.map((f) => f.snap);
  const c = here();
  for (const [who, lo, ln, fo, fn] of [['A', liveAo, liveAn, frAo, frAn], ['B', liveBo, liveBn, frBo, frBn]]) {
    c.account = who;
    const at = who === 'A' ? 0 : 2;
    const liveOut = timedOut[at] || timedOut[at + 1];
    const freshOutHere = freshOut[at] || freshOut[at + 1];
    const account = `L${pair.lane}${who}`;
    // the cold NEW mount of this account, which a cache fault's catch must disagree with
    if (R.mutant) R.mutant.freshNew = freshOut[at + 1] ? null : fn;
    if (!liveOut) compareSnapshots(`${level}:live`, lo, ln, expected, { account, asOf: liveAsOf });
    if (R.mutant) R.mutant.freshNew = null;
    if (!freshOutHere) compareSnapshots(`${level}:fresh`, fo, fn, expected, { account, asOf: fresh[at + 1].asOf });
    if (liveOut || freshOutHere) continue;
    // staleness: which readers differ live vs fresh, per side. Each side is
    // compared with itself, so only tie order is removed.
    const stale = (live, fr) => {
      const groupsFor = callerGroups(live, fr);
      return [...new Set([...Object.keys(live), ...Object.keys(fr)])]
        .filter((k) => {
          const canon = k === 'callers' ? (x) => canonCallerSet(x, groupsFor) : canonFor(readerKind(k));
          const pick = (snap) => (k === 'callers' ? { ...snap[k], __sources: undefined } : snap[k]?.data);
          return JT(canon(pick(live))) !== JT(canon(pick(fr)));
        })
        .sort();
    };
    const so = stale(lo, fo);
    const sn = stale(ln, fn);
    if (so.length) bump(R.staleness.byOp, `${op}:${who}`, 'old');
    if (sn.length) bump(R.staleness.byOp, `${op}:${who}`, 'new');
    if (J(so) !== J(sn)) {
      R.staleness.mismatches++;
      record(`${level}:staleness`, `stale keys ${who}`, 'diff', so, sn, { clean: [lo, ln, fo, fn].every((x) => snapshotClean(x, expected)), account, asOf: liveAsOf });
    } else record(`${level}:staleness`, `stale keys ${who}`, 'equal');
  }
  delete c.account;
  // The property editor's imperative read after a write, run only now: it
  // fetches into the live cache, which would repair a stale reader before
  // the live comparison above saw it.
  const pending = pair.imperative ?? [];
  pair.imperative = [];
  for (const { actor, id } of pending) await compareImperative(pair[actor], id);
  checkStray(pair);
}
async function takeSkipped(...pages) {
  const n = await Promise.all(pages.map((s) => ev(s, 'mutant.takeSkipped')));
  R.mutant.applied += n.reduce((a, x) => a + x.count, 0);
  n.forEach((x, i) => x.count > 0 && mark(pages[i].label, { kind: 'skip-live-update', readers: x.readers }));
}

// One write, through the real mutation hooks: NEW performs it against the
// server, OLD replays NEW's recorded requests and responses.
// The answers the properties service gives a write it refuses on its merits.
const REFUSAL_STATUSES = new Set([400, 403, 409, 422]);
// An option's value as written: the API returns `{ type, value }`.
const optValue = (v) => (v && typeof v === 'object' ? v.value : v);
async function write(pair, actor, name, vars) {
  const acct = pair[actor];
  if (CONFIG.mutant === 'stale-cache') await ev(acct.neu, 'mutant.takeCache');
  acct.neu.tap.mutantArmed = true;
  checkStray(pair);
  acct.neu.tap.rec = [];
  acct.neu.tap.mode = 'record';
  const n = await ev(acct.neu, 'mutate', name, vars);
  acct.neu.tap.mode = 'pass';
  if (CONFIG.mutant === 'skip-live-update') await takeSkipped(acct.neu);
  // read-after-write: the old and new readers, right after the write returned
  await readAfterWrite(acct.neu, name, vars, n);
  acct.old.tap.queue = [...acct.neu.tap.rec];
  acct.old.tap.mismatches = [];
  acct.old.tap.mode = 'replay';
  const o = await ev(acct.old, 'mutate', name, vars);
  acct.old.tap.mode = 'pass';
  // The replay must be the recorded writes, one for one, in order: a write
  // OLD sent differently, or did not send, is a difference in the write path.
  const replay = { requests: acct.neu.tap.rec.length, unused: acct.old.tap.queue.map(({ method, path, body }) => ({ method, path, body })), mismatches: acct.old.tap.mismatches };
  bump(R.coverage, 'write requests per mutation', String(replay.requests));
  // Every catalog write sends at least one request: a hook that succeeded
  // without one (on either side) wrote nothing the replay could compare.
  const empty = (n.ok || o.ok) && replay.requests === 0;
  record('write-replay', empty ? `${name}: succeeded without a request` : name, replay.unused.length || replay.mismatches.length || empty ? 'diff' : 'equal', { sent: 'as recorded' }, replay);
  checkStray(pair);
  bump(R.ops, `${name}:${actor}`, n.ok ? 'ok' : 'rejected');
  // What a create made, for every create (fallbacks included), once it succeeded.
  if (n.ok && name === 'createDef') {
    const body = vars.body;
    cover('created data type', body.data_type.type);
    cover('created scope', body.scope);
    if (/[^\x00-\x7f]/.test(body.display_name)) cover('odd value', 'unicode name');
    if (body.display_name.length > 60) cover('odd value', 'long name');
  }
  if (n.ok && name === 'createTag') cover('tag scope', vars.scope);
  if (!n.ok) {
    const why = (R.rejections[`${name}:${actor}`] ??= {});
    const msg = `${n.error?.class} ${JSON.stringify(n.error?.codes)} ${String(n.message).slice(0, 80)}`;
    why[msg] = (why[msg] ?? 0) + 1;
  }
  // What the caller of mutateAsync gets: resolved with a value, or rejected
  // with an error and message.
  const view = (x) => (x.ok ? { ok: true, value: x.value } : { ok: false, error: x.error, message: x.message });
  record('mutation-result', name, classify(view(o), view(n)), view(o), view(n));
  // The imperative read the property editor runs on a definition it just
  // created or changed (fetchPropertyDefinitionWithOptions), OLD vs NEW.
  const defId = name === 'createDef' ? (n.ok ? (n.value?.id ?? n.value?.definition?.id) : null) : (vars?.propertyDefinitionId ?? null);
  if (defId) (pair.imperative ??= []).push({ actor, id: defId });
  // Both sides refused it on the server's own refusal of the request (every
  // request answered with one, replayed one for one): not a transport, auth,
  // rate-limit or server failure.
  const refused = !n.ok && !o.ok && replay.requests > 0 && !replay.unused.length && !replay.mismatches.length && acct.neu.tap.rec.every((x) => !x.failed && REFUSAL_STATUSES.has(x.status));
  return { n, refused };
}
const canonDefWithOptions = (x) => (x && Array.isArray(x.property_options) ? { ...x, property_options: canonOptions(x.property_options) } : x);
async function compareImperative(acct, id) {
  R.counts.imperativeReads++;
  const [o, n] = await Promise.all([ev(acct.old, 'imperative.fetchDefinitionWithOptions', id), ev(acct.neu, 'imperative.fetchDefinitionWithOptions', id)]);
  if (o.ok !== n.ok) return record('imperative', 'fetchPropertyDefinitionWithOptions', 'diff', o, n);
  if (!o.ok) return compareErrors('imperative', 'fetchPropertyDefinitionWithOptions', o.error, n.error, { oldMessage: o.message, newMessage: n.message });
  record('imperative', 'fetchPropertyDefinitionWithOptions', classify(o.value, n.value, canonDefWithOptions), o.value, n.value, { clean: true, account: acctKey(acct.neu.label), asOf: clockNow() }, canonDefWithOptions);
}
// Read-after-write: the old and new readers right after a write (or an
// out-of-band change), then whether the write is visible to each.
async function readAfterWrite(s, name, vars, result) {
  const keys = [{ k: 'defs', scope: 'all', includeOptions: true }, { k: 'tags' }];
  const defId = vars?.propertyDefinitionId ?? vars?.definitionId;
  // result is null for an out-of-band change, which happened when it returns
  if (defId) keys.push({ k: 'opts', id: defId, why: result && !result.ok ? 'failed write' : 'just written' });
  const c = here();
  const prev = c.phase;
  c.phase = 'read-after-write';
  for (const key of keys) await rawCase(s, key);
  c.phase = prev;
  if (!result?.ok || (name !== 'createDef' && name !== 'deleteDef')) return;
  // visibility: the write is in both readers' answer right away
  const id = name === 'createDef' ? (result.value?.id ?? result.value?.definition?.id) : vars.definitionId;
  const a = { scope: 'all', includeOptions: false };
  const [o, n] = await Promise.all([ev(s, 'raw.old.list', a), ev(s, newRaw('list'), a)]);
  R.visibility.checks++;
  if (!o.ok || !n.ok) {
    R.visibility.readFailures++;
    return record('visibility', `${name}: listing failed`, 'diff', { ok: o.ok, error: o.error ?? null }, { ok: n.ok, error: n.error ?? null });
  }
  const has = (x) => x.value.some((d) => (d.definition?.id ?? d.id) === id);
  const want = name === 'createDef';
  if (has(o) !== want) R.visibility.oldMissing++;
  if (has(n) !== want) R.visibility.newMissing++;
  const shown = { expected: want, old: has(o), new: has(n) };
  record('visibility', name, shown.old === want && shown.new === want ? 'equal' : 'diff', { listed: want }, { listed: { old: shown.old, new: shown.new } });
}

// A seeded operation over what the account can see.
async function step(pair, g, gen) {
  // B also acts after it was removed from the team: its team-scope writes must
  // be refused the same way on both sides.
  const actor = g.chance(0.3) ? 'B' : 'A';
  const acct = pair[actor];
  const cat = await catalog(acct.neu);
  if (cat.listed) cover('catalog size', sizeBucket(cat.defs.length));
  const teamScope = () => (pair.teamCreated && g.chance(0.5) ? 'team' : 'user');
  // Mostly the account's own selects; now and then a system one, whose writes the server refuses.
  const writable = g.chance(0.1) ? cat.selects : cat.ownSelects;
  const withOpts = writable.filter((d) => d.property_options?.length);
  const tagOpts = cat.tagSets.flatMap((s) => s.options.map((o) => ({ ...o, scope: s.scope })));
  const op = g.weighted([
    ['createDef', 6], ['deleteDef', 2], ['addOption', 4], ['updateOption', 3], ['deleteOption', 2],
    ['ensureTagSet', 1], ['createTag', 4], ['updateTag', 2], ['deleteTag', 1.5], ['promoteTag', 1], ['mergeTag', 1],
    ['crmStage', 0.5], ['sqlRename', 1], ['sqlNullColor', 0.5], ['openEditor', 1], ['team', 1.2],
  ]);
  here().op = op;
  here().actor = actor;
  cover('op', op);
  cover('actor', actor === 'A' ? (pair.teamCreated ? 'team owner' : 'owner, no team') : pair.inTeam ? 'team member' : pair.everJoined ? 'revoked member' : 'second user, no team');
  switch (op) {
    case 'createDef':
    case 'crmStage': {
      const scope = op === 'crmStage' ? 'team' : teamScope();
      if (op === 'crmStage' && !pair.inTeam) return write(pair, actor, 'createDef', { body: { display_name: gen.name(), data_type: gen.dataType(), scope: 'user' } });
      const body = op === 'crmStage'
        ? { display_name: 'Deal Stage', data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'Lead' }, { display_order: 1, value: 'Won', color: '#00AA88' }] }, scope }
        : { display_name: gen.name(), data_type: gen.dataType(), scope };
return write(pair, actor, 'createDef', { body });
    }
    case 'deleteDef': {
      const pool = cat.own.filter((d) => defType(d) !== 'TAG');
      if (!pool.length) return write(pair, actor, 'createDef', { body: { display_name: gen.name(), data_type: gen.dataType(), scope: teamScope() } });
      const d = g.pick(pool);
      const res = await write(pair, actor, 'deleteDef', { definitionId: d.definition.id });
      if (res.n.ok) pair.deleted.push(d.definition.id);
      return res;
    }
    case 'addOption': {
      if (!writable.length) return write(pair, actor, 'createDef', { body: { display_name: gen.name(), data_type: { type: 'select_string', multi: false, options: [] }, scope: teamScope() } });
      const d = g.pick(writable);

      const body = defType(d) === 'SELECT_NUMBER'
        ? { type: 'select_number', option: { value: gen.number(), display_order: gen.displayOrder() } }
        : { type: 'select_string', option: { value: gen.optString(), display_order: gen.displayOrder(), ...(g.chance(0.05) ? { color: g.pick(TAG_COLORS) } : {}) } };
const res = await write(pair, actor, 'addOption', { propertyDefinitionId: d.definition.id, body });
      // a refused write to a system definition is coverage too: both sides must refuse it alike
      const target = d.definition.is_system ? 'system definition' : 'own definition';
      if (res?.n?.ok) cover('option write target', target);
      else if (res?.refused) cover('option write target', `${target} (refused)`);
      return res;
    }
    case 'updateOption':
    case 'deleteOption': {
      if (!withOpts.length) return write(pair, actor, 'createDef', { body: { display_name: gen.name(), data_type: gen.dataType(), scope: teamScope() } });
      const d = g.pick(withOpts);
      const o = g.pick(d.property_options);
      if (op === 'deleteOption') return write(pair, actor, 'deleteOption', { propertyDefinitionId: d.definition.id, optionId: o.id });
      const body = {};
      if (g.chance(0.05)) body.color = g.pick(TAG_COLORS);
      if (g.chance(0.5)) body.display_order = gen.displayOrder();
      if (defType(d) !== 'SELECT_NUMBER' && g.chance(0.6)) body.value = gen.optString();
const res = await write(pair, actor, 'updateOption', { propertyDefinitionId: d.definition.id, optionId: o.id, body });
      if (res?.n?.ok && body.value !== undefined && body.value !== optValue(o.value)) cover('odd value', 'rename option');
      return res;
    }
    case 'ensureTagSet':
      return write(pair, actor, 'ensureTagSet', { scope: teamScope() });
    case 'createTag': {
      const scope = teamScope();
return write(pair, actor, 'createTag', { scope, value: gen.optString(), ...(g.chance(0.95) ? { color: g.pick(TAG_COLORS) } : {}) });
    }
    case 'updateTag':
    case 'deleteTag': {
      if (!tagOpts.length) return write(pair, actor, 'createTag', { scope: teamScope(), value: gen.optString(), color: g.pick(TAG_COLORS) });
      const t = g.pick(tagOpts);
      if (op === 'deleteTag') return write(pair, actor, 'deleteTag', { propertyDefinitionId: t.propertyDefinitionId, optionId: t.id });
      const body = {};
      if (g.chance(0.6)) body.value = gen.optString();
      if (g.chance(0.5)) body.color = g.chance(0.95) ? g.pick(TAG_COLORS) : null;
      if (g.chance(0.3)) body.display_order = gen.displayOrder();
const res = await write(pair, actor, 'updateTag', { propertyDefinitionId: t.propertyDefinitionId, optionId: t.id, body });
      if (res?.n?.ok && body.value !== undefined && body.value !== optValue(t.value)) cover('odd value', 'rename tag');
      return res;
    }
    case 'promoteTag': {
      const pool = tagOpts.filter((t) => t.scope === 'user');
      if (!pool.length) return write(pair, actor, 'createTag', { scope: 'user', value: gen.optString(), color: g.pick(TAG_COLORS) });
      return write(pair, actor, 'promoteTag', { optionId: g.pick(pool).id });
    }
    case 'mergeTag': {
      if (tagOpts.length < 2) return write(pair, actor, 'createTag', { scope: teamScope(), value: gen.optString(), color: g.pick(TAG_COLORS) });
      const a = g.pick(tagOpts);
      const b = g.pick(tagOpts.filter((t) => t.id !== a.id));
      return write(pair, actor, 'mergeTag', { optionId: a.id, targetOptionId: b.id });
    }
    case 'sqlRename': {
      // A rename the REST API has no endpoint for (another client, an admin):
      // no hook runs, so open readers stay stale on both sides alike.
      if (!cat.own.length) return null;
      const d = g.pick(cat.own);
      const v = gen.name();
      const ok = sql(`UPDATE property_definitions SET display_name = :'v', updated_at = now() WHERE id = :'id'`, { v, id: d.definition.id });
      bump(R.ops, 'sqlRename', ok ? 'ok' : 'rejected');
      // a rename to the name it already had changes nothing a reader shows
      if (ok && v !== d.definition.display_name) cover('odd value', 'renamed definition');
      await readAfterWrite(acct.neu, op, { definitionId: d.definition.id }, ok ? null : { ok: false });
      return null;
    }
    case 'sqlNullColor': {
      // A tag with no color: the API refuses one, but older rows and other writers have them.
      if (!tagOpts.length) return null;
      const t = g.pick(tagOpts);
      const ok = sql(`UPDATE property_options SET color = NULL, updated_at = now() WHERE id = :'id'`, { id: t.id });
      bump(R.ops, 'sqlNullColor', ok ? 'ok' : 'rejected');
      if (ok && t.color != null) cover('odd value', 'null color');
      await readAfterWrite(acct.neu, op, { propertyDefinitionId: t.propertyDefinitionId }, ok ? null : { ok: false });
      return null;
    }
    case 'openEditor': {
      // The user opens another screen: a new reader mounts mid-sequence.
      const pool = [...cat.selects.map((d) => d.definition.id), ...pair.deleted.slice(-2), ...pair.foreign];
      if (!pool.length) return null;
      const id = g.pick(pool);
      const why = pair.foreign.includes(id) ? "another user's private definition" : pair.deleted.includes(id) ? 'deleted definition' : 'visible';
      cover('option target', why);
      const keys = [...pair.keys, { k: 'opts', id }];
      await setKeys(pair, keys.filter((k, i) => keys.findIndex((x) => J(x) === J(k)) === i));
      return null;
    }
    case 'team': {
      // a join after a first join that failed is a first join, not a re-join
      const [ok, event] = !pair.teamCreated ? [await teamCreate(pair, g), 'created + member joined'] : pair.inTeam ? [await teamRevoke(pair), 'member revoked'] : pair.everJoined ? [await teamJoin(pair), 'member re-joined'] : [await teamJoin(pair), 'created + member joined'];
      if (ok) cover('team event', event);
      // Membership changes what B can read: read-after-write on both accounts.
      for (const a of [pair.A, pair.B]) await readAfterWrite(a.neu, op, {}, null);
      return null;
    }
  }
  return null;
}
// The database's own refusals of a write, which the server enforces for every
// writer alike (property_definitions' unique owner/name indexes, and the
// check_property_name_not_system trigger): the write did not happen, on
// either side, and is counted as refused rather than as a harness failure.
const DB_REFUSALS = [
  ['duplicate name', /duplicate key value violates unique constraint "unique_property_definitions_(user|team)_display_name"/],
  ['reserved system name', /Cannot create custom property with reserved system property name/],
];
// An out-of-band write. It must change exactly the rows it names: a failed
// statement or one that matched nothing is a harness failure, not a quiet
// skip, unless the database refused it for one of the reasons above.
function sql(statement, vars) {
  let out;
  try {
    const args = ['exec', '-i', CONFIG.pg, 'psql', '-U', 'user', '-d', 'macrodb', '-v', 'ON_ERROR_STOP=1'];
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
    out = execFileSync('docker', args, { input: `${statement};\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    const refusal = DB_REFUSALS.find(([, re]) => re.test(String(e.stderr ?? '')));
    if (refusal) {
      bump((R.sqlRefusals ??= {}), refusal[0]);
      return false;
    }
    R.sqlFailures++;
    harnessError(`sql failed: ${firstLine(e)}: ${String(e.stderr ?? '').trim().split('\n')[0].slice(0, 160)}`);
    return false;
  }
  const rows = Number(/^(?:UPDATE|DELETE|INSERT \d+) (\d+)/m.exec(out)?.[1] ?? NaN);
  if (!(rows > 0)) {
    R.sqlFailures++;
    harnessError(`sql changed no rows: ${out.trim().slice(0, 80)}`);
    return false;
  }
  return true;
}
// PostgreSQL's LOWER, under the database's own collation, for every string a
// tie key lowered as PostgreSQL would (see `sqlLower`): one call over stdin, strings as JSON.
function checkCollation() {
  const all = [...LOWERED].filter((x) => !x.includes('\u0000'));
  const res = { strings: all.length, skippedWithNul: LOWERED.size - all.length, mismatches: [] };
  if (!all.length) return res;
  let tag = 'j';
  const json = JSON.stringify(all);
  while (json.includes(`$${tag}$`)) tag += 'j';
  const statement = `SELECT json_agg(lower(s) ORDER BY i) FROM json_array_elements_text($${tag}$${json}$${tag}$::json) WITH ORDINALITY AS t(s, i);\n`;
  const out = execFileSync('docker', ['exec', '-i', CONFIG.pg, 'psql', '-U', 'user', '-d', 'macrodb', '-At', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', maxBuffer: 1 << 28 });
  const pg = JSON.parse(out);
  all.forEach((x, i) => {
    const mine = sqlLower(x);
    if (pg[i] !== mine && res.mismatches.length < 50) res.mismatches.push({ s: x, harness: mine, pg: pg[i] });
  });
  return res;
}

// Every listing key, every option id the account can name, and the tags.
async function sweep(pair, label) {
  const outer = { ...here() };
  for (const acct of [pair.A, pair.B]) {
    setCtx({ lane: pair.lane, generation: pair.generation, phase: `sweep:${label}`, account: acct.name });
    for (const lk of LIST_KEYS) await rawCase(acct.neu, { k: 'defs', ...lk });
    await rawCase(acct.neu, { k: 'tags' });
    const cat = await catalog(acct.neu);
    const ids = [...new Set([...cat.defs.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)])];
    for (const id of ids) await rawCase(acct.neu, { k: 'opts', id, why: cat.defs.find((d) => d.definition.id === id)?.definition.is_system ? 'system definition' : 'visible' });
    for (const id of pair.deleted.slice(-5)) await rawCase(acct.neu, { k: 'opts', id, why: 'deleted definition' });
    for (const id of pair.foreign) await rawCase(acct.neu, { k: 'opts', id, why: acct.name === 'B' ? 'own private definition' : "another user's private definition" });
    await rawCase(acct.neu, { k: 'opts', id: crypto.randomUUID(), why: 'random id' });
  }
  setCtx(outer);
}

async function runLane(lane, seqCount) {
  const g = rng(CONFIG.seed * 1000003 + lane * 7919);
  const gen = makeGen(g);
  let pair = null;
  for (let seq = 0; seq < seqCount; seq++) {
    const rotating = !pair || seq % CONFIG.rotate === 0;
    // The outgoing pair's sweep runs outside any sequence, so it never catches.
    if (rotating && pair) {
      if (CONFIG.sweep) await sweep(pair, 'end');
      await closePair(pair);
    }
    if (R.mutant) {
      R.mutant.running[String(lane)] = true;
      R.mutant.marks = R.mutant.marks.filter((m) => m.lane !== String(lane));
    }
    if (rotating) {
      pair = await newAccountPair(lane, Math.floor(seq / CONFIG.rotate));
      // empty account first, then (most pairs) a team from the start
      setCtx({ lane, generation: pair.generation, seq, step: 0, op: 'empty' });
      await setKeys(pair, chooseKeys(g, await catalog(pair.A.neu), pair));
      await compareStep(pair, 'empty', 'empty');
      if (CONFIG.sweep) await sweep(pair, 'empty');
      if (g.chance(0.75)) await teamCreate(pair, g);
    }
    setCtx({ lane, generation: pair.generation, seq, step: 0, op: 'open' });
    await setKeys(pair, chooseKeys(g, await catalog(pair.A.neu), pair));
    await compareStep(pair, 'open', 'open');
    for (let st = 1; st <= CONFIG.steps; st++) {
      setCtx({ lane, generation: pair.generation, seq, step: st });
      await step(pair, g, gen);
      const c = here();
      c.phase = 'random-read';
      for (let i = 0; i < CONFIG.readsPerStep; i++) {
        const acct = g.chance(0.7) ? pair.A : pair.B;
        c.account = acct.name;
        const cat = await catalog(acct.neu);
        const kind = g.weighted([['defs', 5], ['opts', 3], ['tags', 1]]);
        const ids = [...cat.selects.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)];
        const key = kind === 'defs' ? { k: 'defs', ...g.pick(LIST_KEYS) } : kind === 'tags' || !ids.length ? { k: 'tags' } : { k: 'opts', id: g.pick(ids) };
        await rawCase(acct.neu, key);
      }
      delete c.phase;
      delete c.account;
      await compareStep(pair, 'step', c.op);
      R.counts.steps++;
    }
    // reload: a real page reload of every side, then the same readers again
    setCtx({ lane, generation: pair.generation, seq, step: 'reload', op: 'reload' });
    await Promise.all(sides(pair).map((s) => loadHarness(s)));
    R.counts.reloads += 4;
    await setKeys(pair, pair.keys);
    await compareStep(pair, 'reload', 'reload');
    R.counts.sequences++;
    settleCatch(lane);
    log(`lane ${lane} seq ${seq + 1}/${seqCount}: steps ${R.counts.steps}, raw ${R.counts.rawCases}, differences ${R.totals.differences}`);
    flush();
    if (R.mutant?.firstCatch && E.STOP_ON_CATCH !== '0') break;
  }
  if (pair) {
    if (CONFIG.sweep) await sweep(pair, 'end');
    settleCatch(lane);
    await closePair(pair);
  }
}

// Thousands of definitions, a definition with hundreds of options, hundreds of tags.
async function volumePhase() {
  log(`volume: ${CONFIG.volume} definitions`);
  const g = rng(CONFIG.seed * 31337);
  const gen = makeGen(g);
  const pair = await newAccountPair('V', 0);
  setCtx({ lane: 'V', phase: 'volume' });
  const bodies = Array.from({ length: CONFIG.volume }, (_, i) => ({ body: { display_name: `${gen.name()} v${i % 700}`, data_type: g.chance(0.3) ? gen.dataType() : { type: 'string' }, scope: 'user' } }));
  const big = { body: { display_name: 'Big select', data_type: { type: 'select_string', multi: true, options: [] }, scope: 'user' } };
  pair.A.neu.tap.mode = 'setup';
  const res = await pair.A.neu.page.evaluate(
    async ([bodies, big, nOpts, nTags]) => {
      const h = window.__h;
      const n = { ok: 0, rejected: 0, optionsOk: 0, optionsRejected: 0, tagsOk: 0, tagsRejected: 0 };
      let next = 0;
      const worker = async () => {
        while (next < bodies.length) {
          const r = await h.setup.rest('createPropertyDefinition', bodies[next++]);
          r.ok ? n.ok++ : n.rejected++;
        }
      };
      await Promise.all(Array.from({ length: 16 }, worker));
      const count = (rs, okKey, badKey) => {
        for (const r of rs) r.ok ? n[okKey]++ : n[badKey]++;
      };
      const b = await h.setup.rest('createPropertyDefinition', big);
      const id = b.value?.id ?? b.value?.definition?.id;
      for (let i = 0; i < nOpts; i += 16) count(await Promise.all(Array.from({ length: Math.min(16, nOpts - i) }, (_, j) => h.setup.rest('addPropertyOption', { definition_id: id, body: { type: 'select_string', option: { value: `${(i + j) % 2 ? 'Opt' : 'opt'} ${Math.floor((i + j) / 2)}`, display_order: (i + j) % 5 } } }))), 'optionsOk', 'optionsRejected');
      const set = await h.setup.rest('ensureTagSet', { body: { scope: 'user' } });
      const tagDef = set.value?.definition?.id;
      for (let i = 0; i < nTags; i += 16) count(await Promise.all(Array.from({ length: Math.min(16, nTags - i) }, (_, j) => h.setup.rest('addPropertyOption', { definition_id: tagDef, body: { type: 'select_string', option: { value: `${(i + j) % 2 ? 'Tag' : 'tag'} ${Math.floor((i + j) / 2)}`, display_order: (i + j) % 3, color: '#123456' } } }))), 'tagsOk', 'tagsRejected');
      return { ...n, bigId: id, tagDef };
    },
    [bodies, big, 600, 300]
  );
  pair.A.neu.tap.mode = 'pass';
  R.volume = { requested: CONFIG.volume, options: 600, tags: 300, ...res };
  log(`volume: ${JSON.stringify(res)}`);
  if (!res.bigId || !res.tagDef || res.ok < CONFIG.volume * 0.95 || res.optionsOk < 600 * 0.95 || res.tagsOk < 300 * 0.95) throw new Error(`volume setup incomplete: ${JSON.stringify(res)}`);
  for (const lk of LIST_KEYS) await rawCase(pair.A.neu, { k: 'defs', ...lk });
  await rawCase(pair.A.neu, { k: 'tags' });
  await rawCase(pair.A.neu, { k: 'opts', id: res.bigId, why: `definition with ${res.optionsOk} options` });
  await rawCase(pair.A.neu, { k: 'opts', id: res.tagDef, why: `tag set with ${res.tagsOk} tags` });
  await setKeys(pair, [{ k: 'tags' }, { k: 'defs', scope: 'all', includeOptions: true }, { k: 'defs', scope: 'user', includeOptions: false }, { k: 'defs', scope: 'all', includeOptions: true, forEntityType: 'TASK' }, { k: 'opts', id: res.bigId }, { k: 'opts', id: res.tagDef }]);
  await compareStep(pair, 'volume', 'volume');
  for (let st = 1; st <= 20; st++) {
    setCtx({ lane: 'V', phase: 'volume', step: st });
    await step(pair, g, gen);
    await compareStep(pair, 'volume', here().op);
    R.counts.volumeSteps++;
  }
  await closePair(pair);
}

// Concurrent load: other accounts writing and reading on the same server,
// and (in the fuzzed accounts' own pages) the same user reading through both
// clients, while the differential runs.
const loadPages = [];
async function startLoad() {
  for (let i = 0; i < CONFIG.load; i++) {
    const st = await login(`pc-load-${CONFIG.seed}-${i}-${STAMP}@load-${CONFIG.seed}-${i}-${STAMP}.fuzz.test`);
    const s = await openSide(st, 'neu', `load${i}`);
    s.tap.mode = 'setup'; // a load page only ever writes on the runner's behalf
    loadPages.push(s);
    await s.page.evaluate((seed) => {
      window.__loadStats = { ops: 0, errors: 0 };
      let x = seed;
      const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const h = window.__h;
      (async () => {
        while (!window.__stopLoad) {
          const k = rnd();
          let r;
          if (k < 0.3) r = await h.setup.rest('createPropertyDefinition', { body: { display_name: `load ${Math.floor(rnd() * 1e9)}`, data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'a' }] }, scope: 'user' } });
          else if (k < 0.55) r = await h.raw.neu.list({ scope: 'all', includeOptions: true });
          else if (k < 0.8) r = await h.raw.old.list({ scope: 'all', includeOptions: true });
          else if (k < 0.9) r = await h.raw.neu.tags();
          else r = await h.raw.old.tags();
          window.__loadStats.ops++;
          if (!r.ok) window.__loadStats.errors++;
        }
      })();
    }, CONFIG.seed + i);
  }
}
// The fuzzed user's own NEW page reads both catalogs in the background, so
// the server answers that user's comparisons while serving that user's other
// reads. Restarted after every page load; counted through a binding.
async function startSameUserLoad(s) {
  await s.page.evaluate(() => {
    const h = window.__h;
    (async () => {
      for (let i = 0; !window.__stopLoad; i++) {
        const r = await [() => h.raw.neu.list({ scope: 'all', includeOptions: true }), () => h.raw.old.list({ scope: 'all', includeOptions: true }), () => h.raw.neu.tags(), () => h.raw.old.tags()][i % 4]();
        await window.__sameUserTick(r.ok);
        await new Promise((res) => setTimeout(res, 25));
      }
    })();
  });
}
async function stopLoad() {
  for (const s of loadPages) {
    const st = await s.page.evaluate(() => {
      window.__stopLoad = true;
      return window.__loadStats;
    });
    R.load.ops += st.ops;
    R.load.errors += st.errors;
    await s.ctx.close();
  }
}

function flush() {
  R.updatedAt = new Date().toISOString();
  // written whole and renamed into place, so a reader or a kill never sees half a file
  const tmp = path.join(OUT, 'results.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(R, null, 2));
  fs.renameSync(tmp, path.join(OUT, 'results.json'));
}

// ------------------------------------------------------------------- main ----
log(`seed ${CONFIG.seed}, ${CONFIG.seqs} sequences x ${CONFIG.steps} steps over ${CONFIG.lanes} lanes${CONFIG.mutant ? `, mutant ${CONFIG.mutant}` : ''}${CONFIG.control ? ', CONTROL (old vs old)' : ''}${CONFIG.load ? `, load ${CONFIG.load}` : ''} -> ${OUT}`);
const heartbeat = setInterval(flush, 30000);
const crashed = (what) => (e) => {
  const msg = `${what} crashed: ${firstLine(e)}`;
  R.crashes.push(msg);
  harnessError(`${msg} ${String(e?.stack ?? '').split('\n').slice(1, 6).join(' | ')}`);
  log(msg);
};
try {
  if (CONFIG.load) await startLoad();
  const per = Array.from({ length: CONFIG.lanes }, (_, i) => Math.floor(CONFIG.seqs / CONFIG.lanes) + (i < CONFIG.seqs % CONFIG.lanes ? 1 : 0));
  await Promise.all(per.map((n, lane) => lanes.run({ lane }, () => runLane(lane, n)).catch(crashed(`lane ${lane}`))));
  if (CONFIG.volume && !CONFIG.mutant) await lanes.run({ lane: 'V' }, () => volumePhase()).catch(crashed('volume'));
  if (CONFIG.load) await stopLoad();
} finally {
  clearInterval(heartbeat);
  R.finishedAt = new Date().toISOString();
  flush();
  await browser.close();
}
// An uncaught page error one side has and the other does not is a difference.
for (const msg of new Set([...Object.keys(R.pageErrors.old ?? {}), ...Object.keys(R.pageErrors.neu ?? {})])) {
  const o = R.pageErrors.old?.[msg] ?? 0;
  const n = R.pageErrors.neu?.[msg] ?? 0;
  record('page-errors', msg, (o > 0) === (n > 0) ? 'equal' : 'diff', { seen: o > 0 }, { seen: n > 0 });
}
try {
  R.collation = checkCollation();
} catch (e) {
  R.collation = { error: firstLine(e) };
}
flush();
const real = Object.entries(R.diffSignatures);
log(`done: ${R.counts.sequences} sequences, ${R.counts.steps} steps, ${R.counts.rawCases} raw cases, ${R.counts.readerComparisons} reader and ${R.counts.callerComparisons} caller comparisons; ${R.totals.differences} differences in ${real.length} signatures; ${R.totals.harnessErrors} harness errors; module checks ${JSON.stringify(R.moduleChecks)}`);
for (const [s, n] of real.sort((a, b) => b[1] - a[1])) log(`  ${n}x ${s}`);
const failures = [...R.crashes];
// A mutant run stops at its first catch; every other run must finish all its sequences.
const stoppedOnCatch = !!R.mutant?.firstCatch && E.STOP_ON_CATCH !== '0';
if (R.counts.sequences < CONFIG.seqs && !stoppedOnCatch) failures.push(`ran ${R.counts.sequences} of ${CONFIG.seqs} sequences`);
if (!R.moduleChecks.old || !R.moduleChecks.neu) failures.push('no module check passed on one side');
if (R.sqlFailures) failures.push(`${R.sqlFailures} out-of-band SQL writes failed or changed no rows`);
if (!R.collation || R.collation.error || R.collation.mismatches.length) failures.push(`collation check: ${JSON.stringify(R.collation).slice(0, 300)}`);
log(`collation: ${R.collation?.strings ?? 0} tie-key strings lowercase the same in PostgreSQL${R.collation?.mismatches?.length ? ` except ${R.collation.mismatches.length}` : ''}`);
if (R.mutant) {
  log(`mutant ${R.mutant.name}: applied ${R.mutant.applied}, caught ${R.mutant.firstCatch ? `at ${JSON.stringify(R.mutant.firstCatch).slice(0, 300)}` : 'NO'}; ${R.mutant.discardedCatches} catches discarded in ${R.mutant.taintedSequences} sequences with harness-level differences`);
  if (!R.mutant.applied) failures.push(`mutant ${R.mutant.name} never applied`);
  if (!R.mutant.firstCatch) failures.push(`mutant ${R.mutant.name} not caught`);
}
// The verdict is written last, after every check above: a run without one did not finish.
R.verdict = { passed: !failures.length, failures };
flush();
if (failures.length) {
  log(`FAILED: ${failures.join('; ')}`);
  process.exitCode = 1;
}
