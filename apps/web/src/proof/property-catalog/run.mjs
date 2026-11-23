// Differential fuzz of the property catalog: the base commit's query modules
// (OLD, REST queryFns) against the PR head's (NEW, GraphQL readers), side by
// side in one browser on the local stack. See README.md for what it compares.
//
// Usage: node run.mjs   (configured by environment variables, see CONFIG)
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync as runChild } from 'node:child_process';
import fs from 'node:fs';
import { PerformanceObserver } from 'node:perf_hooks';
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
// What the driver did that blocks its loop, kept when it lasts 100 ms or more,
// so a stall can be matched to its cause: child processes, which run
// synchronously, its own comparisons and results flushes, and garbage
// collection. A stall with none of these in it was spent elsewhere in the
// driver process (Playwright's protocol handling).
const driverWork = [];
function noteWork(what, ms, end = Date.now()) {
  if (ms < 100) return;
  driverWork.push({ end: Math.round(end), ms: Math.round(ms), what });
  if (driverWork.length > 500) driverWork.shift();
}
function execFileSync(file, args, opts) {
  const t = performance.now();
  try {
    return runChild(file, args, opts);
  } finally {
    // the command and its first operands only, never its values
    noteWork([file, ...args.filter((a) => !String(a).startsWith('-')).slice(0, 3)].join(' '), performance.now() - t);
  }
}
function timed(what, f) {
  return (...args) => {
    const t = performance.now();
    try {
      return f(...args);
    } finally {
      noteWork(what, performance.now() - t);
    }
  };
}
new PerformanceObserver((list) => {
  // when the pause happened, not when the observer was told
  for (const e of list.getEntries()) noteWork('gc', e.duration, performance.timeOrigin + e.startTime + e.duration);
}).observe({ entryTypes: ['gc'] });
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
  optimism: E.OPTIMISM === '1', // optimistic states only (optimism.mjs), no sequences
};
let DUMP_LEFT = Number(E.DUMP || 0);
const DUMP_KIND = E.DUMP_KIND ? new RegExp(E.DUMP_KIND) : null;
// DUMP_OPEN=1: dump only the differences a clean run fails on (diff, state)
const DUMP_OPEN = E.DUMP_OPEN === '1';
// DUMP_LANE=n: every comparison of that lane but the equal ones, open or not
const DUMP_LANE = E.DUMP_LANE ?? null;
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

// Tie order. The server sorts definitions by display_name lowercased in Rust
// (both listings, with and without options), and
// options by (display_order, number_value, LOWER(string_value)) (tag options:
// display_order, LOWER(string_value)), with no tiebreaker, so rows whose keys
// are equal come back in either order on both paths. Only those lists are
// canonicalized, by sorting each run of equal keys by id; the outer tag-set
// list and every other array keep their order.
const rowId = (el) => (Array.isArray(el) ? (typeof el[0] === 'string' ? el[0] : undefined) : (el?.definition?.id ?? el?.id ?? el?.propertyId ?? el?.definitionId));
function defKey(e) {
  const d = e?.definition ?? e;
  if (!d || typeof d !== 'object' || typeof d.display_name !== 'string') return null;
  return `d:${rustLower(d.display_name)}`;
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
// ------------------------------------------------------------ twin worlds ----
// OLD's accounts and NEW's are different users on the same server, and each
// side writes for real. Every id OLD's world names is paired with the id NEW's
// world gave the same row (`pair.ids`, O -> N), and OLD's values are
// translated into NEW's world before any comparison. An id with no pair stays
// as it is, so a row one world has and the other lacks is a difference.
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function trString(pair, s) {
  const direct = pair.ids.get(s);
  if (direct !== undefined) return direct;
  let out = s.replace(UUID_RE, (u) => pair.ids.get(u) ?? pair.ids.get(u.toLowerCase()) ?? u);
  // the account tag names the world in every email, domain and user id
  for (const [o, n] of pair.subst) out = out.split(o).join(n);
  return out;
}
// The harness sorts a Map's entries and a Set's members by OLD's raw ids;
// once those ids are translated, NEW's order is their order, so sort again.
const byKey = (a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);
const byJson = (a, b) => (J(a) < J(b) ? -1 : J(a) > J(b) ? 1 : 0);
function tr(pair, x) {
  if (!pair) return x;
  if (Array.isArray(x)) return x.map((v) => tr(pair, v));
  if (x && typeof x === 'object') {
    const keys = Object.keys(x);
    if (keys.length === 1 && keys[0] === '<map>' && Array.isArray(x['<map>'])) return { '<map>': tr(pair, x['<map>']).sort(byKey) };
    if (keys.length === 1 && keys[0] === '<set>' && Array.isArray(x['<set>'])) return { '<set>': tr(pair, x['<set>']).sort(byJson) };
    const o = {};
    for (const [k, v] of Object.entries(x)) o[trString(pair, k)] = tr(pair, v);
    return o;
  }
  return typeof x === 'string' ? trString(pair, x) : x;
}
// Timestamps differ between the worlds; what a row's two stamps say is kept:
// created, and whether it changed since.
function stampTs(x) {
  if (Array.isArray(x)) return x.map(stampTs);
  if (!x || typeof x !== 'object') return x;
  const o = {};
  const row = isRow(x);
  const created = Object.entries(x).find(([k]) => /^created_?at$/i.test(k))?.[1];
  for (const [k, v] of Object.entries(x)) {
    if (row && typeof v === 'string' && /^created_?at$/i.test(k)) o[k] = '<ts>';
    else if (row && typeof v === 'string' && /^updated_?at$/i.test(k)) o[k] = typeof created === 'string' && (instant(v) ?? v) === (instant(created) ?? created) ? '<ts:same>' : '<ts:later>';
    else o[k] = stampTs(v);
  }
  return o;
}
const prepN = (x) => stampTs(x);
const prepO = (pair, x) => stampTs(tr(pair, x));
function pairOne(pair, o, n, how) {
  if (typeof o !== 'string' || typeof n !== 'string' || o === n) return;
  const was = pair.ids.get(o);
  if (was === n) return;
  if (was !== undefined || pair.rev.has(n)) {
    R.idMap.conflicts++;
    return;
  }
  pair.ids.set(o, n);
  pair.rev.set(n, o);
  R.idMap[how]++;
}
// Two results of the same write, walked in parallel: ids at the same place pair.
function pairIds(pair, o, n, how = 'explicit') {
  if (isUuid(o) && isUuid(n)) return pairOne(pair, o, n, how);
  if (Array.isArray(o) && Array.isArray(n)) {
    if (o.length === n.length) o.forEach((v, i) => pairIds(pair, v, n[i], how));
    return;
  }
  if (o && n && typeof o === 'object' && typeof n === 'object') for (const k of Object.keys(o)) if (k in n) pairIds(pair, o[k], n[k], how);
}
// A definition's identity apart from its ids and stamps, in NEW's world.
const OWNER_IDS = ['user_id', 'team_id', 'userId', 'teamId'];
function defIdentity(pair, d) {
  const { id, created_at, updated_at, owner, ...rest } = d;
  const own = owner && typeof owner === 'object' ? Object.fromEntries(Object.entries(owner).filter(([k]) => !OWNER_IDS.includes(k))) : owner;
  return J(tr(pair, { ...rest, owner: own }));
}
const optIdentity = (o) => J({ value: o.value, order: o.display_order ?? o.displayOrder, color: o.color ?? null });
// Rows the explicit pairing did not reach (a fallback create, what a team
// brought, a volume of rows): equal identities pair in list order.
function pairByIdentity(pair, os, ns, identity, onPair) {
  const pool = new Map();
  for (const n of ns) {
    const k = identity(n);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k).push(n);
  }
  for (const o of os) {
    const k = identity(o);
    const cands = pool.get(k);
    if (!cands?.length) continue;
    // the row the id map already names, else the first unpaired one
    const id = o.definition?.id ?? o.id;
    const at = cands.findIndex((n) => (n.definition?.id ?? n.id) === (pair.ids.get(id) ?? id));
    const i = at >= 0 ? at : cands.findIndex((n) => !pair.rev.has(n.definition?.id ?? n.id));
    if (i < 0) continue;
    const [n] = cands.splice(i, 1);
    onPair(o, n);
  }
}
function pairOptions(pair, os, ns) {
  pairByIdentity(pair, os ?? [], ns ?? [], optIdentity, (o, n) => pairOne(pair, o.id, n.id, 'structural'));
}
async function syncIds(pair) {
  for (const who of ['A', 'B']) {
    const acct = pair[who];
    const [o, n] = await Promise.all([ev(acct.old, 'setup.catalog'), ev(acct.neu, 'setup.catalog')]);
    if (o.defs.ok && n.defs.ok)
      pairByIdentity(pair, o.defs.value, n.defs.value, (e) => defIdentity(pair, e.definition), (a, b) => {
        pairOne(pair, a.definition.id, b.definition.id, 'structural');
        for (const k of OWNER_IDS) pairOne(pair, a.definition.owner?.[k], b.definition.owner?.[k], 'structural');
        pairOptions(pair, a.property_options, b.property_options);
      });
    if (o.tags.ok && n.tags.ok)
      pairByIdentity(pair, o.tags.value, n.tags.value, (s) => s.scope, (a, b) => {
        pairOne(pair, a.definition?.id, b.definition?.id, 'structural');
        pairOptions(pair, a.options, b.options);
      });
  }
}

// --------------------------------------------------------------- results ----
const OLD_COMMIT = E.OLD_COMMIT ?? 'c8b5760036c';
const R = {
  config: { ...CONFIG },
  commit: git('rev-parse', 'HEAD'),
  // The code under test is the web PR's head; the harness commit only adds this directory.
  prHead: E.PR_HEAD ?? '3ffe3a5f86c',
  identicalToPrHeadOutsideProof: git('diff', '--quiet', E.PR_HEAD ?? '3ffe3a5f86c', 'HEAD', '--', '.', ':(exclude)apps/web/src/proof') !== null,
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
  // writes whose resolved value the head dropped, by operation (`VALUE_DROPPED`)
  valueDropped: {},
  // live differences where main's reader was stale and the head's current
  // (see `oldStaleExcuses`), by operation and reader
  oldStale: { byOp: {}, staleness: 0, inherited: 0, pointwise: 0, wholeReader: 0, headStaleInherited: 0 },
  failedReadData: { lists: 0, editorRows: 0 },
  visibility: { checks: 0, oldMissing: 0, newMissing: 0, readFailures: 0 },
  harnessErrors: [],
  settleTimeouts: [], // every settle timeout, whole (first 1,000)
  diffs: [], // first 400 real differences with context
  diffSignatures: {}, // signature -> count
  examples: {}, // class -> first few examples
  mutant: CONFIG.mutant ? { name: CONFIG.mutant, applied: 0, caughtBy: {}, firstCatch: null, ignoredAsInBaseline: 0, beforeApplied: 0, candidate: {}, candidatesBy: {}, tainted: {}, running: {}, marks: [], clock: 0, discardedCatches: 0, taintedSequences: 0 } : null,
  load: CONFIG.load ? { pages: CONFIG.load, ops: 0, errors: 0, sameUserReads: 0, sameUserErrors: 0 } : null,
  idMap: { explicit: 0, structural: 0, conflicts: 0 },
  writeTransport: {}, // mutation -> side -> request sequence -> n
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
const NOT_A_CATCH = new Set(['settle', 'write-transport', 'page-errors']);
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
// Live readers and callers whose difference is main's staleness alone, for
// the comparison running now (set by compareStep, `oldStaleExcuses`).
let OLD_STALE = null;
// While live copies are compared: each side's cold mount at the same step, so
// a dumped live difference carries what the server says beside it.
let FRESH_PAIR = null;
function freshOf(snap, kind) {
  const caller = /^caller\.(.+)$/.exec(kind);
  if (caller) return snap?.callers?.[caller[1]];
  const reader = /^reader(\{.*\})(\.data)?$/.exec(kind);
  if (!reader) return undefined;
  return reader[2] ? snap?.[reader[1]]?.data : snap?.[reader[1]];
}
function record(level, kind, cls, a, b, extra = {}, canon = (x) => x) {
  if ((cls === 'diff' || cls === 'state') && OLD_STALE?.has(kind)) {
    cls = 'old-stale';
    bump(R.oldStale.byOp, here().op ?? level, kind.replace(UUID_RE, '<id>'));
  }
  bump(R.classes, level, cls);
  // DUMP_KIND=<regex>: also every equal comparison of a matching kind (within DUMP_LANE, if set)
  if (cls === 'equal' && DUMP_KIND && DUMP_LEFT > 0 && DUMP_KIND.test(kind) && (DUMP_LANE === null || String(here().lane) === DUMP_LANE)) {
    DUMP_LEFT--;
    const fresh = FRESH_PAIR ? { freshOld: freshOf(FRESH_PAIR.fo, kind), freshNeu: freshOf(FRESH_PAIR.fn, kind) } : {};
    fs.appendFileSync(path.join(OUT, 'dump.jsonl'), `${JSON.stringify({ level, kind, cls, at: here(), old: a, neu: b, ...fresh, write: LAST_WRITE })}\n`);
  }
  if (cls === 'equal') return;
  // DUMP=n: the first n differences in full, both sides, to out/<run>/dump.jsonl
  if (DUMP_LEFT > 0 && cls !== 'tie-order' && cls !== 'timestamp-format' && (DUMP_LANE !== null ? String(here().lane) === DUMP_LANE : !DUMP_OPEN || cls === 'diff' || cls === 'state')) {
    DUMP_LEFT--;
    const fresh = FRESH_PAIR ? { freshOld: freshOf(FRESH_PAIR.fo, kind), freshNeu: freshOf(FRESH_PAIR.fn, kind) } : {};
    fs.appendFileSync(path.join(OUT, 'dump.jsonl'), `${JSON.stringify({ level, kind, cls, at: here(), old: a, neu: b, ...fresh, write: LAST_WRITE })}\n`);
  }
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
      await page.getByText('Continue with email').first().click({ timeout: 150000 });
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
// Every web module the PR changed (run.sh lists them and writes each one's
// base copy beside it as `*.__old__.*`): an OLD page loads the base copies.
const OLD_MODULES = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'out', 'old-modules.json'), 'utf8')));
const oldModule = (u) => OLD_MODULES.has(new URL(u.toString()).pathname);
const oldCopy = (p) => p.replace(/\.([a-z]+)$/, '.__old__.$1');
// The properties service, on any host: behind the local proxy
// (`/dss/properties/...`) or on a direct DSS port (`/properties/...`).
const PROPS_PATH = /(^|\/)properties(\/|$)/;
const isWrite = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method());
// The operations of a GraphQL request that writes, by name. Comments are
// stripped first, every operation of a batch counts, and a body with no query
// text (a persisted query) counts as a write unless it names a catalog read.
function graphqlMutationOps(req) {
  // A GET (the app's cached reads) or an empty POST carries no operation.
  if (!isWrite(req)) return [];
  let body;
  try {
    body = req.postDataJSON();
  } catch {
    return [];
  }
  if (body === null || body === undefined) return [];
  return (Array.isArray(body) ? body : [body]).flatMap((b) => {
    const name = b?.operationName ?? null;
    if (typeof b?.query !== 'string') return String(name ?? '').startsWith('PropertyCatalog') ? [] : [name ?? '(unnamed)'];
    const text = b.query.replace(/#[^\n\r]*/g, ' ');
    const m = /(^|[\s}])(mutation|subscription)\s*([A-Za-z_][A-Za-z0-9_]*)?/.exec(text);
    return m ? [name ?? m[3] ?? '(unnamed)'] : [];
  });
}
const graphqlOp = (req) => {
  try {
    return req.postDataJSON()?.operationName ?? null;
  } catch {
    return null;
  }
};
// Writes the page sends outside the properties service and GraphQL, by side,
// tap mode and route (ids masked): a census, and in a write window a stray.
const maskIds = (p) => p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\/\d+(?=\/|$)/g, '/<n>');
// timeout records only: also hide long tokens; the write census keeps literal routes apart
const maskPath = (p) => maskIds(p.replace(/[A-Za-z0-9_.~-]{24,}/g, '<token>'));
// Writes either page sends that never touch the catalog, seen in a smoke run:
// the session token refresh, which the auth client sends on its own clock.
// Still counted in `otherWrites`; never a stray.
const IGNORED_WRITE = /^POST [^ ]+\/auth\/jwt\/refresh$/;

// One side (OLD or NEW) of one account: its own browser context and page.
async function openSide(storageState, side, label) {
  const bctx = await browser.newContext({ ...CTX_OPTS, storageState });
  await baseRoutes(bctx);
  // mode: pass (no write expected), setup (the runner's own writes), write
  // (a write window: every write the page sends is counted in `window`)
  const tap = { mode: 'pass', window: [], stray: [], mutantArmed: false };
  const sameUserLoad = CONFIG.load > 0 && side === 'neu' && /^L\d/.test(label);
  if (sameUserLoad)
    await bctx.exposeBinding('__sameUserTick', (_src, ok) => {
      R.load.sameUserReads++;
      if (!ok) R.load.sameUserErrors++;
    });
  const old = side === 'old' || CONFIG.control;
  if (old)
    await bctx.route(oldModule, async (r) => {
      const u = new URL(r.request().url());
      u.pathname = oldCopy(u.pathname);
      // A failed module fetch fails the page load, which loadHarness retries; it
      // must never fall back to the head's module on the OLD side.
      const resp = await r.fetch({ url: u.toString(), maxRedirects: 0 }).catch((e) => (harnessError(`${label}: old module ${u.pathname}: ${firstLine(e)}`), null));
      if (!resp || resp.status() !== 200) return r.abort('failed');
      await r.fulfill({ response: resp });
    });
  if (side === 'neu' && ['drop-row', 'swap-order', 'alter-field'].includes(CONFIG.mutant)) {
    const g = rng(CONFIG.seed * 7919 + label.length);
    await bctx.route(/\/graphql/, async (r) => {
      const op = graphqlOp(r.request());
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
  // Every write the page sends. In a write window it is counted, with its
  // answer; outside one, a catalog write (REST or a GraphQL mutation) or any
  // other write is a stray, unless it is the runner's own setup.
  const entries = new WeakMap();
  bctx.on('request', (req) => {
    const u = new URL(req.url());
    const p = u.pathname;
    const role = old ? 'old side' : 'new side';
    let entry = null;
    if (PROPS_PATH.test(p)) {
      if (!isWrite(req)) bump(R.traffic, role, 'REST GET /properties');
      else entry = { kind: 'rest', method: req.method(), path: maskIds(p.replace(/^.*?\/properties/, '/properties')) };
    } else if (/graphql/.test(p)) {
      const op = graphqlOp(req);
      if (op?.startsWith('PropertyCatalog')) bump(R.traffic, role, `GraphQL ${op}`);
      const ops = graphqlMutationOps(req);
      if (ops.length) {
        bump(R.otherWrites, `${side}:${tap.mode}`, `GraphQL ${ops.join('+')}`);
        entry = { kind: 'gql', method: req.method(), path: p, op: ops.join('+') };
      }
    } else if (isWrite(req)) {
      const route = `${req.method()} ${u.host}${maskIds(p)}`;
      bump(R.otherWrites, `${side}:${tap.mode}`, route);
      if (!IGNORED_WRITE.test(route)) entry = { kind: 'other', method: req.method(), path: route };
    }
    if (!entry) return;
    if (tap.mode === 'write') {
      entry.status = null;
      entry.failed = false;
      entries.set(req, entry);
      tap.window.push(entry);
    } else if (tap.mode !== 'setup') tap.stray.push({ ...entry, mode: tap.mode });
  });
  bctx.on('response', (res) => {
    const e = entries.get(res.request());
    if (e) e.status = res.status();
  });
  bctx.on('requestfailed', (req) => {
    const e = entries.get(req);
    if (e) e.failed = true;
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
  // The status comes from the response event, so a request moves from
  // inflight to finished at once, timed when it finished.
  const statuses = new WeakMap();
  page.on('response', (res) => statuses.set(res.request(), res.status()));
  page.on('requestfinished', (r) => {
    const x = inflight.get(r);
    inflight.delete(r);
    if (!x) return;
    const end = Date.now();
    finished.push({ ...x, status: statuses.get(r) ?? null, ms: end - x.at, end });
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
  // NEW reads through the normalized cache, as the app does: a page whose
  // cache did not start would read through the network alone.
  if (!s.old) {
    const cache = await ev(s, 'cacheState');
    if (cache.init !== 'ready' || !cache.host) throw new Error(`${s.label}: normalized cache not running: ${JSON.stringify(cache)}`);
  }
  // By physical side: in CONTROL both sides run the base commit's modules.
  R.moduleChecks[s.side]++;
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
// What a reader's caller can branch on: its status flags (isPlaceholderData
// only where the hook defines it), its data, and whether it holds an error.
// The error object itself is transport-specific (a REST result error on OLD,
// a GraphQL CombinedError on NEW) and no caller reads its fields.
const STATE_FIELDS = ['isPending', 'isSuccess', 'isError', 'isFetched', 'isLoading', 'isPlaceholderData'];
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
  record(level, `${kind}.error`, (a.error === null) === (b.error === null) ? 'equal' : 'diff', { error: a.error !== null }, { error: b.error !== null });
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
const compareSnapshots = timed('compare snapshots', (level, a, b, expected, at) => {
  const groupsFor = callerGroups(a, b);
  for (const k of new Set([...Object.keys(a), ...Object.keys(b), ...expected, 'callers'])) {
    if (k === 'callers') {
      if (!a.callers || !b.callers) record(`${level}:caller`, 'callers', 'state', a.callers ?? null, b.callers ?? null, { note: 'callers missing' });
      else compareCallers(level, a, b, groupsFor, at);
    } else compareReader(level, k, a[k], b[k], at);
  }
});
// Raw read case: OLD's queryFn in OLD's world and NEW's read in NEW's, at
// once. Both answering is compared as data. Both failing is compared as
// failing: what each transport says about a failure is its own, and callers
// see a failed read only through the reader's error state, compared above.
const compareRaw = timed('compare raw', (pair, kind, k, oldR, newR, account) => {
  R.counts.rawCases++;
  const level = `raw:${here().phase ?? 'read'}`;
  if (oldR.ok !== newR.ok) return record(level, kind, 'diff', { ok: oldR.ok, error: oldR.error ?? null, message: oldR.message ?? null }, { ok: newR.ok, error: newR.error ?? null, message: newR.message ?? null });
  if (!oldR.ok) {
    bump(R.coverage, 'raw outcome', 'both errored');
    bump(R.coverage, 'raw error pair', `${oldR.error?.class}/${oldR.error?.httpStatus ?? '-'} => ${newR.error?.class}/${newR.error?.httpStatus ?? '-'}/${JSON.stringify(newR.error?.graphqlCodes ?? null)}`);
    return record(level, `${kind}.error`, 'equal');
  }
  bump(R.coverage, 'raw outcome', 'both ok');
  const canon = canonFor(k);
  const a = prepO(pair, oldR.value);
  const b = prepN(newR.value);
  return record(level, kind, classify(a, b, canon), a, b, { clean: true, account, asOf: clockNow() }, canon);
});
// In CONTROL both halves of a raw case run the base commit's functions.
const newRaw = (fn) => (CONFIG.control ? `raw.old.${fn}` : `raw.neu.${fn}`);
// One read of one account: the key names OLD's ids; NEW reads its pair.
async function rawCase(pair, who, key) {
  const acct = pair[who];
  const nkey = tr(pair, key);
  const account = `L${pair.lane}${who}`;
  if (key.k === 'defs') {
    cover('listing scope', key.scope);
    cover('listing includeOptions', key.includeOptions);
    cover('listing forEntityType', key.forEntityType ?? 'none');
    const a = { scope: key.scope, includeOptions: key.includeOptions, forEntityType: key.forEntityType };
    const [o, n] = await Promise.all([ev(acct.old, 'raw.old.list', a), ev(acct.neu, newRaw('list'), a)]);
    if (o.ok) {
      cover('listing size', sizeBucket(o.value.length));
      coverTies('definitions', o.value, defKey);
    }
    compareRaw(pair, `defs:${key.scope}:${key.includeOptions ? 'opts' : 'plain'}:${key.forEntityType ?? '-'}`, 'defs', o, n, account);
  } else if (key.k === 'opts') {
    cover('option target', key.why ?? 'visible');
    const [o, n] = await Promise.all([ev(acct.old, 'raw.old.options', key.id), ev(acct.neu, newRaw('options'), nkey.id)]);
    if (o.ok) {
      cover('options size', sizeBucket(o.value.length));
      coverTies('options', o.value, optKey);
    }
    compareRaw(pair, `opts:${key.why ?? 'visible'}`, 'opts', o, n, account);
  } else {
    const [o, n] = await Promise.all([ev(acct.old, 'raw.old.tags'), ev(acct.neu, newRaw('tags'))]);
    if (o.ok) {
      cover('tag count', sizeBucket(o.value.reduce((t, set) => t + set.options.length, 0)));
      for (const set of o.value) coverTies('tag options', set.options, optKey);
    }
    compareRaw(pair, 'tags', 'tags', o, n, account);
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
// What the account can see now in OLD's world, by REST (the generator only
// needs OLD's ids; NEW's are their pairs, and it never feeds the comparison).
async function catalog(pair, who) {
  const { defs, tags } = await ev(pair[who].old, 'setup.catalog');
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
const createdId = (v) => v?.id ?? v?.definition?.id ?? null;

// ------------------------------------------------------------------ lanes ----
// A lane's four accounts: A and B in OLD's world and in NEW's. The world is
// the last part of each account's tag, so translating `-o` to `-n` there turns
// every email, domain and user id of OLD's world into NEW's.
async function newAccountPair(lane, generation) {
  const tag = `${CONFIG.seed}-${lane}-${generation}-${STAMP}`;
  // A domain per account: a team auto-joins its owner's domain, which must be unique.
  const email = (role, w) => `pc-${role}-${tag}-${w}@${role}-${tag}-${w}.fuzz.test`;
  const [aO, aN, bO, bN] = await Promise.all([login(email('owner', 'o')), login(email('owner', 'n')), login(email('member', 'o')), login(email('member', 'n'))]);
  const A = { name: 'A', old: await openSide(aO, 'old', `L${lane}A-old`), neu: await openSide(aN, 'neu', `L${lane}A-neu`) };
  const B = { name: 'B', old: await openSide(bO, 'old', `L${lane}B-old`), neu: await openSide(bN, 'neu', `L${lane}B-neu`) };
  const pair = { lane, generation, A, B, ids: new Map(), rev: new Map(), subst: [[`${tag}-o`, `${tag}-n`]], inTeam: false, teamCreated: false, everJoined: false, bUserId: null, deleted: [], foreign: [] };
  // B's private user definition: an id A may not read (permission dimension).
  const body = { body: { display_name: `B private ${tag}`, data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'secret' }] }, scope: 'user' } };
  const [po, pn] = await Promise.all([ev(B.old, 'setup.rest', 'createPropertyDefinition', body), ev(B.neu, 'setup.rest', 'createPropertyDefinition', body)]);
  if (po.ok && pn.ok) {
    pairIds(pair, po.value, pn.value);
    pair.foreign.push(createdId(po.value));
  } else harnessError(`B private definition: ${po.message ?? ''} ${pn.message ?? ''}`);
  await syncIds(pair);
  return pair;
}
async function closePair(pair) {
  for (const acct of [pair.A, pair.B]) for (const s of [acct.old, acct.neu]) await s.ctx.close().catch(() => {});
}
const sides = (pair) => [pair.A.old, pair.A.neu, pair.B.old, pair.B.neu];
// Team setup runs in both worlds alike; both must succeed, or the worlds part.
async function bothWorlds(what, f) {
  const [o, n] = await Promise.all([f('old'), f('neu')]);
  if (!o.ok || !n.ok) harnessError(`${what}: ${o.ok ? 'ok' : `${JSON.stringify(o.error)} ${o.message}`} / ${n.ok ? 'ok' : `${JSON.stringify(n.error)} ${n.message}`}`);
  return [o, n];
}
async function teamCreate(pair, g) {
  const name = `Fuzz team ${pair.lane}-${pair.generation}-${g.int(1e6)}`;
  const [o, n] = await bothWorlds('createTeam', (w) => ev(pair.A[w], 'setup.auth', 'createTeam', { name }));
  if (!o.ok || !n.ok) return false;
  pairIds(pair, o.value?.id, n.value?.id);
  pair.teamCreated = true;
  return teamJoin(pair);
}
async function teamJoin(pair) {
  const [lo, ln] = await bothWorlds('invite link', (w) => ev(pair.A[w], 'setup.auth', 'createTeamInviteLink'));
  if (!lo.ok || !ln.ok) return false;
  const link = { old: lo.value.token, neu: ln.value.token };
  const [jo, jn] = await bothWorlds('join', (w) => ev(pair.B[w], 'setup.auth', 'joinTeamByInviteLink', link[w]));
  if (!jo.ok || !jn.ok) return false;
  const [to, tn] = await bothWorlds('getTeam', (w) => ev(pair.A[w], 'setup.auth', 'getTeam'));
  const roles = (t) => {
    const owner = t.ok ? t.value?.members?.find((m) => m.role === 'owner') : null;
    return { team: t.ok ? (t.value?.team?.id ?? null) : null, owner: owner?.user_id ?? null, member: t.ok ? (t.value?.members?.find((m) => m !== owner)?.user_id ?? null) : null };
  };
  const ro = roles(to);
  const rn = roles(tn);
  for (const k of ['team', 'owner', 'member']) pairOne(pair, ro[k], rn[k], 'explicit');
  pair.bUserId = ro.member && rn.member ? { old: ro.member, neu: rn.member } : null;
  pair.inTeam = true;
  pair.everJoined = true;
  await syncIds(pair);
  return true;
}
async function teamRevoke(pair) {
  if (!pair.bUserId) return false;
  const [o, n] = await bothWorlds('remove', (w) => ev(pair.A[w], 'setup.auth', 'removeUserFromTeam', pair.bUserId[w]));
  if (!o.ok || !n.ok) return false;
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
const keysFor = (pair, s, keys) => (s.side === 'old' ? keys : tr(pair, keys));
async function setKeys(pair, keys) {
  pair.keys = keys;
  // OLD opens the keys as they name its world, NEW their pairs
  await Promise.all(sides(pair).map((s) => ev(s, 'setKeys', keysFor(pair, s, keys))));
  for (const k of keys) cover('open reader', k.k === 'defs' ? `defs:${k.scope}` : k.k);
}
// What a side that timed out was still waiting on: its busy queries, its API
// requests in flight (with their age) and its last failed requests. `since` is
// when the driver made the call, so only what overlapped the call is kept;
// `overlapMs` says how much of each entry fell inside it.
function withWaitedOn(s, t, since) {
  if (!t.timedOut) return t;
  const now = Date.now();
  const overlap = (x) => Math.min(x.end, now) - Math.max(x.end - x.ms, since);
  const recent = s.finished
    .filter((x) => x.end >= since)
    .map((x) => ({ method: x.method, path: x.path, status: x.status, startedAgoMs: now - x.at, ms: x.ms }));
  const stalls = driverStalls.filter((x) => overlap(x) > 0).map((x) => ({ endedAgoMs: now - x.end, ms: x.ms, overlapMs: overlap(x) }));
  const work = driverWork.filter((x) => overlap(x) > 0).map((x) => ({ endedAgoMs: now - x.end, ms: x.ms, overlapMs: overlap(x), what: x.what }));
  return { ...t, waitedOn: { busy: t.busy ?? null, fetches: t.fetches ?? null, driverStalls: stalls, driverWork: work, inflight: [...s.inflight.values()].map((x) => ({ method: x.method, path: x.path, ms: now - x.at })), recent, net: (s.netlog ?? []).slice(-8) } };
}
async function settleAll(pair) {
  // what a side that timed out waited on is sampled as its settle returns
  const res = await Promise.all(
    sides(pair).map(async (s) => {
      const since = Date.now();
      return withWaitedOn(s, await ev(s, 'settle', CONFIG.settleMs), since);
    })
  );
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
// Writes a side sent outside a write window (a late retry, a mutation the
// cache replayed on its own, OLD writing by itself): each is a difference,
// checked before any window opens and at every comparison.
function checkStray(pair) {
  for (const [who, s] of [['A new', pair.A.neu], ['A old', pair.A.old], ['B new', pair.B.neu], ['B old', pair.B.old]]) {
    if (!s.tap.stray.length) continue;
    record('write-transport', `write outside a write window (${who})`, 'diff', [], s.tap.stray.map(({ kind, method, path, op, mode }) => ({ kind, method, path: maskIds(path), op, mode })));
    s.tap.stray = [];
  }
}
// After a step: live (open readers) OLD vs NEW, fresh (a cold load) OLD vs
// NEW, and within each side live vs fresh, whose staleness must match. OLD's
// snapshots are translated into NEW's world first.
// Main's staleness alone. A live reader (or caller) whose difference is only
// that main missed an update: main's live copy differs from main's own cold
// mount, the head's live copy equals the head's cold mount, and the two cold
// mounts agree. Such a difference is class `old-stale`, counted by operation
// and reader in `oldStale` instead of as a difference; a head that is stale
// itself, or reads otherwise cold, never qualifies.
function oldStaleExcuses(lo, ln, fo, fn, prev) {
  const out = new Set();
  const same = (x, y, canon) => JT(canon(x)) === JT(canon(y));
  // the cold mounts to compare with: this step's, then the last step's
  const refsOf = (pick) => [[pick(fo), pick(fn)], ...(prev ? [[pick(prev.fo), pick(prev.fn)]] : [])];
  for (const k of new Set([...Object.keys(lo), ...Object.keys(ln)])) {
    if (k === 'callers') continue;
    const canon = canonFor(readerKind(k));
    const d = (s) => s?.[k]?.data;
    if (!same(d(lo), d(fo), canon) && same(d(ln), d(fn), canon) && same(d(fo), d(fn), canon)) out.add(`reader${k}.data`);
    // The whole reader (flags, data, error) the same way: main kept a read
    // the server now refuses (a definition deleted, a team left), and the
    // head's reader shows the refusal its cold mount and main's show.
    const whole = (s) => readerWhole(s?.[k], canon);
    const wholeShown = whole(ln) === whole(fn) && whole(fo) === whole(fn);
    const wholeShownLast = !!prev && whole(ln) === whole(prev.fn) && whole(prev.fo) === whole(prev.fn) && whole(lo) !== whole(fo) && whole(lo) !== whole(ln);
    if (whole(lo) !== whole(fo) && (wholeShown || wholeShownLast)) {
      R.oldStale.wholeReader++;
      for (const kind of [`reader${k}`, `reader${k}.data`, `reader${k}.error`]) out.add(kind);
    } else if (!out.has(`reader${k}.data`) && !same(d(lo), d(ln), canon) && fresherPointwise(canon(d(lo)), canon(d(ln)), refsOf((x) => canon(d(x))))) {
      R.oldStale.pointwise++;
      out.add(`reader${k}.data`);
    }
  }
  const of = (s, c) => s?.callers?.[c];
  const gOld = callerGroups(lo, fo);
  const gNew = callerGroups(ln, fn);
  const gFresh = callerGroups(fo, fn);
  for (const c of new Set([...Object.keys(lo?.callers ?? {}), ...Object.keys(ln?.callers ?? {})])) {
    if (c === '__sources') continue;
    const by = (g) => (x) => canonCallers(x, g(c));
    if (!same(of(lo, c), of(fo, c), by(gOld)) && same(of(ln, c), of(fn, c), by(gNew)) && same(of(fo, c), of(fn, c), by(gFresh))) out.add(`caller.${c}`);
    else if (!same(of(lo, c), of(ln, c), by(gFresh)) && fresherPointwise(by(gFresh)(of(lo, c)), by(gFresh)(of(ln, c)), refsOf((x) => by(gFresh)(of(x, c))))) {
      R.oldStale.pointwise++;
      out.add(`caller.${c}`);
    }
  }
  return out;
}
// A reader as its caller sees it, for the whole-reader rule.
const readerWhole = (r, canon) => (r ? JT({ flags: STATE_FIELDS.map((f) => r[f] ?? null), data: canon(r.data) ?? null, error: r.error !== null && r.error !== undefined }) : null);

// Main's staleness alone, point by point. Both live copies can be stale at
// once (another account wrote, and neither page is told), and the head's can
// have caught up on part of it: its own writes reload every list they change,
// which brings in the other account's rows too, where main refetched only the
// lists its invalidation named; and the head's cold mount shares the
// normalized cache (a new screen does), so what it read last step is on the
// head's live screen now, where main's cold mount had a client of its own.
// Excused when every place the head's live copy differs from main's shows
// what both cold mounts show there, this step or the last: a row (matched by
// id), a field, a set member. The last step's counts only where main's copy
// is not this step's, so a head that kept an older value than main never
// qualifies. Rows the head lists must also keep a cold mount's order (or
// main's). A head that shows anything no cold mount showed never qualifies.
function rowKey(x) {
  if (typeof x === 'string') return `s:${x}`;
  if (Array.isArray(x) && x.length === 2 && typeof x[0] === 'string') return `t:${x[0]}`;
  if (x && typeof x === 'object') {
    const id = x.id ?? x.definition?.id;
    if (typeof id === 'string') return `i:${id}`;
    if (typeof x.scope === 'string' && 'options' in x) return `c:${x.scope}`;
  }
  return null;
}
function keyedRows(a) {
  const m = new Map();
  for (const x of a) {
    const k = rowKey(x);
    if (k === null || m.has(k)) return null;
    m.set(k, x);
  }
  return m;
}
// A value no cold mount can match: what a cold mount had where the shapes differ.
const NO_MATCH = Symbol('no match');
const shapeOf = (x) => (Array.isArray(x) ? 'array' : x && typeof x === 'object' ? 'object' : 'leaf');
const JN = (x) => (x === NO_MATCH ? null : JT(x));
function fresherPointwise(lo, ln, refs) {
  if (JT(lo) === JT(ln)) return true;
  const shown = (i) => {
    const [o, n] = refs[i];
    return o !== NO_MATCH && n !== NO_MATCH && JT(ln) === JT(n) && JT(o) === JT(n);
  };
  if (shown(0)) return true;
  if (refs.slice(1).some((_, j) => shown(j + 1)) && JN(refs[0][0]) !== JT(lo)) return true;
  const shape = shapeOf(ln);
  if (shape === 'leaf' || shapeOf(lo) !== shape) return false;
  const fit = (x) => (x !== NO_MATCH && shapeOf(x) === shape ? x : NO_MATCH);
  const pairs = refs.map(([o, n]) => [fit(o), fit(n)]);
  if (shape === 'array') {
    const rows = (x) => (x === NO_MATCH ? NO_MATCH : keyedRows(x));
    const mo = rows(lo);
    const mn = rows(ln);
    const mr = pairs.map(([o, n]) => [rows(o), rows(n)]);
    if (mo === null || mn === null || mr.some(([o, n]) => o === null || n === null)) return false;
    const get = (m, k) => (m === NO_MATCH ? NO_MATCH : m.get(k));
    const keys = new Set([...mo.keys(), ...mn.keys(), ...mr.flatMap(([o, n]) => [...(o === NO_MATCH ? [] : o.keys()), ...(n === NO_MATCH ? [] : n.keys())])]);
    for (const k of keys) if (!fresherPointwise(get(mo, k), get(mn, k), mr.map(([o, n]) => [get(o, k), get(n, k)]))) return false;
    const order = (m, other) => J([...m.keys()].filter((k) => other.has(k)));
    return order(mn, mo) === order(mo, mn) || mr.some(([, n]) => n !== NO_MATCH && order(mn, n) === order(n, mn));
  }
  const at = (x, k) => (x === NO_MATCH ? NO_MATCH : x[k]);
  const keys = new Set([lo, ln, ...pairs.flat()].flatMap((x) => (x === NO_MATCH ? [] : Object.keys(x))));
  for (const k of keys) if (!fresherPointwise(at(lo, k), at(ln, k), pairs.map(([o, n]) => [at(o, k), at(n, k)]))) return false;
  return true;
}
// A live difference main's staleness left behind. Main's copy was stale at
// the last comparison (excused there), and since then neither live copy has
// moved while a write neither side is told of (another account's) made both
// stale; the cold mounts still agree. Without this, a difference excused once
// would come back as a regression the first time the head also falls behind,
// though the head is never staler than main there. A copy that moved, or cold
// mounts that disagree, still count.
const LAST_LIVE = new Map();
// Each account's cold mounts at its last comparison, for the point-by-point rule.
const LAST_FRESH = new Map();
function inheritedExcuses(key, lo, ln, fo, fn) {
  const out = new Set();
  const last = LAST_LIVE.get(key);
  if (!last) return out;
  const same = (x, y, canon) => JT(canon(x)) === JT(canon(y));
  for (const kind of last.excused) {
    const caller = /^caller\.(.+)$/.exec(kind);
    if (caller) {
      const c = caller[1];
      const of = (snap) => snap?.callers?.[c];
      const by = (g) => (x) => canonCallers(x, g(c));
      if (same(of(lo), of(last.lo), by(callerGroups(lo, last.lo))) && same(of(ln), of(last.ln), by(callerGroups(ln, last.ln))) && same(of(fo), of(fn), by(callerGroups(fo, fn)))) out.add(kind);
      continue;
    }
    const m = /^reader(\{.*\})(\.data|\.error)?$/.exec(kind);
    if (!m) continue;
    const k = m[1];
    const canon = canonFor(readerKind(k));
    if (m[2] === '.data') {
      const d = (snap) => snap?.[k]?.data;
      if (same(d(lo), d(last.lo), canon) && same(d(ln), d(last.ln), canon) && same(d(fo), d(fn), canon)) out.add(kind);
    } else {
      const whole = (snap) => readerWhole(snap?.[k], canon);
      if (whole(lo) === whole(last.lo) && whole(ln) === whole(last.ln) && whole(fo) === whole(fn)) out.add(kind);
    }
  }
  return out;
}

// The staleness record, given each side's stale keys: main's staleness alone
// when the head's stale keys are a subset of main's and every key only main
// has stale is excused (for `callers`, every caller main has stale).
// A key stale on the head alone is accepted only when it is carried: an
// excused difference where neither live copy has moved since, which a write
// neither side is told of left stale on the head while main's older copy
// happens to match the server again.
function staleOnlyOnOld(so, sn, excuses, lo, fo, inherited, ln, fn) {
  const headOnly = sn.filter((k) => !so.includes(k));
  const gNew = callerGroups(ln, fn);
  const carried = headOnly.every((k) => {
    if (k !== 'callers') return inherited.has(`reader${k}.data`);
    const stale = Object.keys(ln?.callers ?? {}).filter((c) => c !== '__sources' && JT(canonCallers(ln.callers[c], gNew(c))) !== JT(canonCallers(fn?.callers?.[c], gNew(c))));
    return stale.length > 0 && stale.every((c) => inherited.has(`caller.${c}`));
  });
  if (!carried) return false;
  if (headOnly.length) R.oldStale.headStaleInherited++;
  const gOld = callerGroups(lo, fo);
  return so
    .filter((k) => !sn.includes(k))
    .every((k) => {
      if (k !== 'callers') return excuses.has(`reader${k}.data`);
      const stale = Object.keys(lo?.callers ?? {}).filter((c) => c !== '__sources' && JT(canonCallers(lo.callers[c], gOld(c))) !== JT(canonCallers(fo?.callers?.[c], gOld(c))));
      return stale.length > 0 && stale.every((c) => excuses.has(`caller.${c}`));
    });
}
// A failed read is compared by its flags and error alone, not by the list
// it still holds. What a failed read holds is the client's cache, not the
// server: a TanStack read that fails keeps the data it had, and main's app
// shares one QueryClient, so a new screen there shows the cached list too;
// but the runner's cold mount on main has an empty QueryClient (no data,
// `placeholderData` dropped on failure), while the head's shares the
// normalized cache as a new screen does, and keeps that list (or its empty
// stand-in: `catalogListResult` data is always a list). For the same reason a
// select editor row over a failed option read (`usablePropertyOptions`: the
// read's data, else none) is compared without its options. Counted in
// `failedReadData`.
function failedReadsHoldNoData(snap) {
  if (!snap || typeof snap !== 'object') return snap;
  const out = { ...snap };
  const failed = new Set();
  for (const [k, r] of Object.entries(snap)) {
    if (k === 'callers' || !r || r.isError !== true) continue;
    failed.add(k);
    if (r.data != null) R.failedReadData.lists++;
    out[k] = { ...r, data: null };
  }
  const editors = snap.callers?.selectEditors;
  if (Array.isArray(editors) && editors.some((row) => failed.has(JSON.stringify({ k: 'opts', id: row?.id })))) {
    out.callers = {
      ...snap.callers,
      selectEditors: editors.map((row) => {
        if (!failed.has(JSON.stringify({ k: 'opts', id: row?.id })) || !('shown' in row)) return row;
        R.failedReadData.editorRows++;
        return { ...row, shown: '<failed read>' };
      }),
    };
  }
  return out;
}
async function compareStep(pair, level, op) {
  checkStray(pair);
  const timedOut = await settleAll(pair);
  const news = [pair.A.neu, pair.B.neu];
  if (CONFIG.mutant === 'stale-cache') {
    const restored = await Promise.all(news.map((s) => ev(s, 'mutant.restoreCache')));
    if (restored.some((x) => x.restored > 0)) R.mutant.applied++;
    restored.forEach((x, i) => x.restored > 0 && mark(news[i].label, { kind: 'stale-cache', readers: x.readers.map((r) => ({ id: r.id, data: prepN(r.data) })) }));
  }
  if (CONFIG.mutant === 'skip-live-update') {
    const n = await Promise.all(news.map((s) => ev(s, 'mutant.takeFrozen')));
    R.mutant.applied += n.reduce((a, x) => a + x.count, 0);
    n.forEach((x, i) => x.count > 0 && mark(news[i].label, { kind: 'skip-live-update', readers: x.readers.map((r) => ({ id: r.id, data: prepN(r.data) })) }));
  }
  const keys = pair.keys;
  const expected = tr(pair, keys).map((k) => JSON.stringify(k));
  const prep = (s, x) => failedReadsHoldNoData(s.side === 'old' ? prepO(pair, x) : prepN(x));
  // Only a fault applied before a snapshot was taken can show in it.
  const liveAsOf = clockNow();
  const [liveAo, liveAn, liveBo, liveBn] = await Promise.all(sides(pair).map(async (s) => prep(s, await ev(s, 'snapshot'))));
  // the frozen readers go back to live before the fresh mounts read
  if (CONFIG.mutant === 'skip-live-update') await Promise.all(news.map((s) => ev(s, 'mutant.release')));
  const fresh = await Promise.all(
    sides(pair).map(async (s) => {
      const since = Date.now();
      const f = await ev(s, 'fresh', keysFor(pair, s, keys), CONFIG.settleMs);
      return { snap: prep(s, f.snap), timing: withWaitedOn(s, f.timing, since), asOf: clockNow() };
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
    // main's staleness alone is excused only with both cold mounts in hand
    const liveKey = `${account}:${c.seq}`;
    const fresh0 = freshOutHere ? new Set() : oldStaleExcuses(lo, ln, fo, fn, LAST_FRESH.get(liveKey) ?? null);
    const inherited = freshOutHere ? new Set() : inheritedExcuses(liveKey, lo, ln, fo, fn);
    const excuses = new Set([...fresh0, ...inherited]);
    for (const k of inherited) if (!fresh0.has(k)) R.oldStale.inherited++;
    OLD_STALE = excuses;
    if (!liveOut) LAST_LIVE.set(liveKey, { lo, ln, excused: excuses });
    FRESH_PAIR = freshOutHere ? null : { fo, fn };
    if (freshOutHere) LAST_FRESH.delete(liveKey);
    else LAST_FRESH.set(liveKey, { fo, fn });
    if (!liveOut) compareSnapshots(`${level}:live`, lo, ln, expected, { account, asOf: liveAsOf });
    OLD_STALE = null;
    FRESH_PAIR = null;
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
    if (J(so) !== J(sn) && staleOnlyOnOld(so, sn, excuses, lo, fo, inherited, ln, fn)) {
      R.oldStale.staleness++;
      record(`${level}:staleness`, `stale keys ${who}`, 'old-stale', so, sn);
    } else if (J(so) !== J(sn)) {
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
  for (const { actor, id } of pending) await compareImperative(pair, actor, id);
  checkStray(pair);
}

// One write, through the real mutation hooks, in both worlds at once: OLD's
// hook with OLD's ids, NEW's with their pairs. Each really writes.
// The answers the properties service gives a write it refuses on its merits.
const REFUSAL_STATUSES = new Set([400, 403, 404, 409, 422]);
// An option's value as written: the API returns `{ type, value }`.
const optValue = (v) => (v && typeof v === 'object' ? v.value : v);
// The GraphQL operations each NEW hook may send, the last one the write itself.
// Writes the head resolves with nothing where main resolved with the changed
// option (updates) or `{ success: true }` (deletes). The head's hooks type the
// result `void`, so the type check proves no caller reads it: the tag editor
// passes `onSuccess: onClose` (`() => void`), Settings → Tags passes no
// callback, and the option and definition deletes have no caller outside
// tests. The value is left out of their mutation-result comparison.
const VALUE_DROPPED = {
  updateTag: 'TagEditorDialog closes on success and reads no value',
  updateOption: 'no caller outside tests',
  deleteTag: 'TagEditorDialog closes on success; Settings → Tags reads nothing',
  deleteOption: 'no caller outside tests',
  deleteDef: 'no caller outside tests',
};
const NEW_OPS = {
  createDef: ['CreatePropertyDefinition'],
  deleteDef: ['DeletePropertyDefinition'],
  addOption: ['AddPropertyOption'],
  updateOption: ['UpdatePropertyOption'],
  deleteOption: ['DeletePropertyOption'],
  ensureTagSet: ['EnsureTagSet'],
  createTag: ['EnsureTagSet', 'AddPropertyOption'],
  updateTag: ['UpdatePropertyOption'],
  deleteTag: ['DeletePropertyOption'],
  promoteTag: ['PromoteTag'],
  mergeTag: ['MergeTag'],
};
// What one side sent in its write window, and what is wrong with it: OLD
// (main's code) writes through REST only, NEW through GraphQL mutations only,
// and a write that succeeded sent the request that does it.
function transport(name, s, res) {
  const w = s.tap.window;
  const seq = w.map((e) => (e.kind === 'gql' ? `GraphQL ${e.op}` : `${e.kind === 'rest' ? 'REST' : 'other'} ${e.method} ${e.path}`));
  bump(R.writeTransport, name, s.old ? 'main modules' : 'head modules', seq.join(', ') || '(none)');
  const rest = w.filter((e) => e.kind === 'rest');
  const ops = w.filter((e) => e.kind === 'gql').flatMap((e) => e.op.split('+'));
  const problems = [];
  if (w.some((e) => e.kind === 'other')) problems.push('a write outside the catalog');
  if (s.old) {
    if (ops.length) problems.push('main sent a GraphQL mutation');
    if (res.ok && !rest.length) problems.push('succeeded without a request');
  } else {
    if (rest.length) problems.push('head sent a REST catalog write');
    if (ops.some((o) => !NEW_OPS[name].includes(o))) problems.push('head sent another GraphQL operation');
    // A tag set the cache already lists as provisioned answers without a
    // request (provisionTagSet in tags.ts); the mutation result, compared
    // with main's below, shows it is the set the server has.
    const fromCache = name === 'ensureTagSet' && res.ok && ops.length === 0;
    if (fromCache) bump(R.coverage, 'ensureTagSet answered', 'from the cache');
    else if (res.ok && ops.at(-1) !== NEW_OPS[name].at(-1)) problems.push(`succeeded without ${NEW_OPS[name].at(-1)} last`);
  }
  return { sent: seq, problems };
}
// A request in the window that never got an answer, or a server failure:
// a write refused for that reason is not refused on its merits.
const transportFailed = (s, res) => s.tap.window.some((e) => e.failed || (e.status !== null && e.status >= 500)) || res.error?.network === true;
// The step's write as each side ran it, for the dump only.
let LAST_WRITE = null;
async function write(pair, actor, name, vars) {
  const acct = pair[actor];
  const nvars = tr(pair, vars);
  if (CONFIG.mutant === 'stale-cache') await ev(acct.neu, 'mutant.takeCache');
  if (CONFIG.mutant === 'skip-live-update') await ev(acct.neu, 'mutant.freeze');
  acct.neu.tap.mutantArmed = true;
  checkStray(pair);
  for (const s of [acct.old, acct.neu]) {
    s.tap.window = [];
    s.tap.mode = 'write';
  }
  const [o, n] = await Promise.all([ev(acct.old, 'mutate', name, vars), ev(acct.neu, 'mutate', name, nvars)]);
  for (const s of [acct.old, acct.neu]) s.tap.mode = 'pass';
  if (DUMP_LEFT > 0) {
    const brief = (x) => (x.ok ? { ok: true } : { ok: false, message: x.message ?? null });
    LAST_WRITE = { name, actor, vars, old: brief(o), neu: brief(n) };
  }
  const to = transport(name, acct.old, o);
  const tn = transport(name, acct.neu, n);
  const problems = [...to.problems.map((p) => `old: ${p}`), ...tn.problems.map((p) => `new: ${p}`)];
  bump(R.coverage, 'write requests per mutation', `${to.sent.length}/${tn.sent.length}`);
  record('write-transport', problems.length ? `${name}: ${problems.join('; ')}` : name, problems.length ? 'diff' : 'equal', { sent: to.sent }, { sent: tn.sent });
  // the ids each world gave the rows this write made, then any it did not name
  if (o.ok && n.ok) pairIds(pair, o.value, n.value);
  await syncIds(pair);
  bump(R.ops, `${name}:${actor}`, o.ok === n.ok ? (n.ok ? 'ok' : 'rejected') : `old ${o.ok ? 'ok' : 'rejected'}, new ${n.ok ? 'ok' : 'rejected'}`);
  // What a create made, for every create (fallbacks included), once it succeeded.
  if (o.ok && name === 'createDef') {
    const body = vars.body;
    cover('created data type', body.data_type.type);
    cover('created scope', body.scope);
    if (/[^\x00-\x7f]/.test(body.display_name)) cover('odd value', 'unicode name');
    if (body.display_name.length > 60) cover('odd value', 'long name');
  }
  if (o.ok && name === 'createTag') cover('tag scope', vars.scope);
  for (const [side, x] of [['old', o], ['new', n]]) {
    if (x.ok) continue;
    const why = (R.rejections[`${name}:${actor}:${side}`] ??= {});
    const msg = `${x.error?.class} ${JSON.stringify(x.error?.codes ?? x.error?.graphqlCodes)} ${maskIds(String(x.message)).slice(0, 80)}`;
    why[msg] = (why[msg] ?? 0) + 1;
  }
  // What the caller of mutateAsync gets: resolved with a value, or rejected
  // with what the callers branch on (a reserved name, a tag conflict); and
  // the toasts the hook showed either way.
  // A write the head resolves with nothing, where main resolved with the row
  // (`VALUE_DROPPED`): only whether it resolved, and its toasts, are compared.
  const dropped = n.ok && n.value === undefined && VALUE_DROPPED[name];
  if (dropped && o.ok && o.value !== undefined) bump(R.valueDropped, name, 'main resolved a value');
  const view = (x) => (x.ok ? { ok: true, ...(dropped ? {} : { value: x.value }), toasts: x.toasts } : { ok: false, contract: x.contract, toasts: x.toasts });
  const vo = prepO(pair, view(o));
  const vn = prepN(view(n));
  record('mutation-result', name, classify(vo, vn), vo, vn, { account: `L${pair.lane}${actor}`, ...(o.ok ? {} : { oldMessage: maskIds(String(o.message)) }), ...(n.ok ? {} : { newMessage: maskIds(String(n.message)) }) });
  // read-after-write: both worlds' readers, right after the write returned
  await readAfterWrite(pair, actor, name, vars, o, n);
  // The imperative read the property editor runs on a definition it just
  // created or changed (fetchPropertyDefinitionWithOptions), OLD vs NEW.
  const defId = name === 'createDef' ? (o.ok ? createdId(o.value) : null) : (vars?.propertyDefinitionId ?? null);
  if (defId) (pair.imperative ??= []).push({ actor, id: defId });
  // Both worlds refused it on the server's own refusal (OLD's REST answered
  // with a refusal; nothing failed in transport on either side).
  const refused = !o.ok && !n.ok && !transportFailed(acct.old, o) && !transportFailed(acct.neu, n) && acct.old.tap.window.some((e) => e.kind === 'rest' && REFUSAL_STATUSES.has(e.status));
  return { o, n, refused };
}
const canonDefWithOptions = (x) => (x && Array.isArray(x.property_options) ? { ...x, property_options: canonOptions(x.property_options) } : x);
async function compareImperative(pair, actor, id) {
  R.counts.imperativeReads++;
  const acct = pair[actor];
  const [o, n] = await Promise.all([ev(acct.old, 'imperative.fetchDefinitionWithOptions', id), ev(acct.neu, 'imperative.fetchDefinitionWithOptions', tr(pair, id))]);
  if (o.ok !== n.ok) return record('imperative', 'fetchPropertyDefinitionWithOptions', 'diff', { ok: o.ok, message: o.message ?? null }, { ok: n.ok, message: n.message ?? null });
  if (!o.ok) return record('imperative', 'fetchPropertyDefinitionWithOptions.error', 'equal');
  const a = prepO(pair, o.value);
  const b = prepN(n.value);
  record('imperative', 'fetchPropertyDefinitionWithOptions', classify(a, b, canonDefWithOptions), a, b, { clean: true, account: `L${pair.lane}${actor}`, asOf: clockNow() }, canonDefWithOptions);
}
// Read-after-write: both worlds' reads right after a write (or an
// out-of-band change, o and n null), then whether the write is visible to each.
async function readAfterWrite(pair, who, name, vars, o, n) {
  const keys = [{ k: 'defs', scope: 'all', includeOptions: true }, { k: 'tags' }];
  const defId = vars?.propertyDefinitionId ?? vars?.definitionId;
  if (defId) keys.push({ k: 'opts', id: defId, why: o && !o.ok ? 'failed write' : 'just written' });
  const c = here();
  const prev = c.phase;
  c.phase = 'read-after-write';
  for (const key of keys) await rawCase(pair, who, key);
  c.phase = prev;
  if (!o?.ok || !n?.ok || (name !== 'createDef' && name !== 'deleteDef')) return;
  // visibility: the write is in both readers' answer right away
  const acct = pair[who];
  const idO = name === 'createDef' ? createdId(o.value) : vars.definitionId;
  const idN = name === 'createDef' ? createdId(n.value) : tr(pair, vars.definitionId);
  const a = { scope: 'all', includeOptions: false };
  const [lo, ln] = await Promise.all([ev(acct.old, 'raw.old.list', a), ev(acct.neu, newRaw('list'), a)]);
  R.visibility.checks++;
  if (!lo.ok || !ln.ok) {
    R.visibility.readFailures++;
    return record('visibility', `${name}: listing failed`, 'diff', { ok: lo.ok, error: lo.error ?? null }, { ok: ln.ok, error: ln.error ?? null });
  }
  const has = (x, id) => x.value.some((d) => (d.definition?.id ?? d.id) === id);
  const want = name === 'createDef';
  const shown = { old: has(lo, idO), new: has(ln, idN) };
  if (shown.old !== want) R.visibility.oldMissing++;
  if (shown.new !== want) R.visibility.newMissing++;
  record('visibility', name, shown.old === want && shown.new === want ? 'equal' : 'diff', { listed: want }, { listed: shown });
}

// A seeded operation over what the account can see.
async function step(pair, g, gen) {
  // B also acts after it was removed from the team: its team-scope writes must
  // be refused the same way on both sides.
  const actor = g.chance(0.3) ? 'B' : 'A';
  const cat = await catalog(pair, actor);
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
      const ok = sqlBoth(pair, `UPDATE property_definitions SET display_name = :'v', updated_at = now() WHERE id = :'id'`, { v, id: d.definition.id }, ['id']);
      bump(R.ops, 'sqlRename', ok ? 'ok' : 'rejected');
      // a rename to the name it already had changes nothing a reader shows
      if (ok && v !== d.definition.display_name) cover('odd value', 'renamed definition');
      await readAfterWrite(pair, actor, op, { definitionId: d.definition.id }, ok ? null : { ok: false }, ok ? null : { ok: false });
      return null;
    }
    case 'sqlNullColor': {
      // A tag with no color: the API refuses one, but older rows and other writers have them.
      if (!tagOpts.length) return null;
      const t = g.pick(tagOpts);
      const ok = sqlBoth(pair, `UPDATE property_options SET color = NULL, updated_at = now() WHERE id = :'id'`, { id: t.id }, ['id']);
      bump(R.ops, 'sqlNullColor', ok ? 'ok' : 'rejected');
      if (ok && t.color != null) cover('odd value', 'null color');
      await readAfterWrite(pair, actor, op, { propertyDefinitionId: t.propertyDefinitionId }, ok ? null : { ok: false }, ok ? null : { ok: false });
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
      for (const who of ['A', 'B']) await readAfterWrite(pair, who, op, {}, null, null);
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
// The same out-of-band write in both worlds: OLD's rows by their ids, NEW's
// by their pairs. The worlds hold the same rows, so the database must answer
// both alike.
function sqlBoth(pair, statement, vars, idKeys) {
  const nvars = { ...vars };
  for (const k of idKeys) nvars[k] = tr(pair, vars[k]);
  const o = sql(statement, vars);
  const n = sql(statement, nvars);
  if (o !== n) record('sql', 'out-of-band write', 'diff', { applied: o }, { applied: n });
  return o && n;
}
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
  for (const who of ['A', 'B']) {
    setCtx({ lane: pair.lane, generation: pair.generation, phase: `sweep:${label}`, account: who });
    for (const lk of LIST_KEYS) await rawCase(pair, who, { k: 'defs', ...lk });
    await rawCase(pair, who, { k: 'tags' });
    const cat = await catalog(pair, who);
    const ids = [...new Set([...cat.defs.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)])];
    for (const id of ids) await rawCase(pair, who, { k: 'opts', id, why: cat.defs.find((d) => d.definition.id === id)?.definition.is_system ? 'system definition' : 'visible' });
    for (const id of pair.deleted.slice(-5)) await rawCase(pair, who, { k: 'opts', id, why: 'deleted definition' });
    for (const id of pair.foreign) await rawCase(pair, who, { k: 'opts', id, why: who === 'B' ? 'own private definition' : "another user's private definition" });
    await rawCase(pair, who, { k: 'opts', id: crypto.randomUUID(), why: 'random id' });
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
      await setKeys(pair, chooseKeys(g, await catalog(pair, 'A'), pair));
      await compareStep(pair, 'empty', 'empty');
      if (CONFIG.sweep) await sweep(pair, 'empty');
      if (g.chance(0.75)) await teamCreate(pair, g);
    }
    setCtx({ lane, generation: pair.generation, seq, step: 0, op: 'open' });
    await setKeys(pair, chooseKeys(g, await catalog(pair, 'A'), pair));
    await compareStep(pair, 'open', 'open');
    for (let st = 1; st <= CONFIG.steps; st++) {
      setCtx({ lane, generation: pair.generation, seq, step: st });
      await step(pair, g, gen);
      const c = here();
      c.phase = 'random-read';
      for (let i = 0; i < CONFIG.readsPerStep; i++) {
        const who = g.chance(0.7) ? 'A' : 'B';
        c.account = who;
        const cat = await catalog(pair, who);
        const kind = g.weighted([['defs', 5], ['opts', 3], ['tags', 1]]);
        const ids = [...cat.selects.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)];
        const key = kind === 'defs' ? { k: 'defs', ...g.pick(LIST_KEYS) } : kind === 'tags' || !ids.length ? { k: 'tags' } : { k: 'opts', id: g.pick(ids) };
        await rawCase(pair, who, key);
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

// Thousands of definitions, a definition with hundreds of options, hundreds of
// tags, made alike in both worlds. Names are unique (ignoring case) so each
// world keeps the same rows however its parallel creates interleave.
async function volumePhase() {
  log(`volume: ${CONFIG.volume} definitions`);
  const g = rng(CONFIG.seed * 31337);
  const gen = makeGen(g);
  const pair = await newAccountPair('V', 0);
  setCtx({ lane: 'V', phase: 'volume' });
  const seen = new Set();
  const bodies = [];
  for (let i = 0; bodies.length < CONFIG.volume; i++) {
    const display_name = `${gen.name()} v${i % 700}`;
    const dataType = g.chance(0.3) ? gen.dataType() : { type: 'string' };
    if (seen.has(display_name.toLowerCase())) continue;
    seen.add(display_name.toLowerCase());
    bodies.push({ body: { display_name, data_type: dataType, scope: 'user' } });
  }
  const big = { body: { display_name: 'Big select', data_type: { type: 'select_string', multi: true, options: [] }, scope: 'user' } };
  const fill = (s) =>
    s.page.evaluate(
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
  for (const s of [pair.A.old, pair.A.neu]) s.tap.mode = 'setup';
  const [ro, rn] = await Promise.all([fill(pair.A.old), fill(pair.A.neu)]);
  for (const s of [pair.A.old, pair.A.neu]) s.tap.mode = 'pass';
  pairOne(pair, ro.bigId, rn.bigId, 'explicit');
  pairOne(pair, ro.tagDef, rn.tagDef, 'explicit');
  await syncIds(pair);
  R.volume = { requested: CONFIG.volume, options: 600, tags: 300, old: ro, neu: rn };
  log(`volume: old ${JSON.stringify(ro)} new ${JSON.stringify(rn)}`);
  for (const res of [ro, rn]) if (!res.bigId || !res.tagDef || res.ok < CONFIG.volume * 0.95 || res.optionsOk < 600 * 0.95 || res.tagsOk < 300 * 0.95) throw new Error(`volume setup incomplete: ${JSON.stringify(res)}`);
  for (const lk of LIST_KEYS) await rawCase(pair, 'A', { k: 'defs', ...lk });
  await rawCase(pair, 'A', { k: 'tags' });
  await rawCase(pair, 'A', { k: 'opts', id: ro.bigId, why: `definition with ${ro.optionsOk} options` });
  await rawCase(pair, 'A', { k: 'opts', id: ro.tagDef, why: `tag set with ${ro.tagsOk} tags` });
  await setKeys(pair, [{ k: 'tags' }, { k: 'defs', scope: 'all', includeOptions: true }, { k: 'defs', scope: 'user', includeOptions: false }, { k: 'defs', scope: 'all', includeOptions: true, forEntityType: 'TASK' }, { k: 'opts', id: ro.bigId }, { k: 'opts', id: ro.tagDef }]);
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
// transports, while the differential runs. REST reads go through the runner's
// own client (`setup.rest`): the head's service client no longer reads the catalog.
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
          else if (k < 0.8) r = await h.setup.rest('listProperties', { scope: 'all', include_options: true });
          else if (k < 0.9) r = await h.raw.neu.tags();
          else r = await h.setup.rest('listTags');
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
        const r = await [() => h.raw.neu.list({ scope: 'all', includeOptions: true }), () => h.setup.rest('listProperties', { scope: 'all', include_options: true }), () => h.raw.neu.tags(), () => h.setup.rest('listTags')][i % 4]();
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

const flush = timed('flush', () => {
  R.updatedAt = new Date().toISOString();
  // written whole and renamed into place, so a reader or a kill never sees half a file
  const tmp = path.join(OUT, 'results.json.tmp');
  fs.writeFileSync(tmp, JSON.stringify(R, null, 2));
  fs.renameSync(tmp, path.join(OUT, 'results.json'));
});

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
  if (CONFIG.optimism) {
    const { runOptimism } = await import('./optimism.mjs');
    await lanes.run({ lane: 'O' }, () => runOptimism({ CONFIG, R, log, sleep, login, openSide, loadHarness, ev, harnessError, firstLine, STAMP })).catch(crashed('optimism'));
  }
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
{
  const n = Object.values(R.oldStale.byOp).reduce((a, x) => a + Object.values(x).reduce((b, y) => b + y, 0), 0);
  if (n || R.oldStale.staleness) log(`main stale, head current: ${n} live differences (${R.oldStale.inherited} excused keys carried from an earlier step where neither side moved) and ${R.oldStale.staleness} staleness records (oldStale in results.json)`);
  if (Object.keys(R.valueDropped).length) log(`value dropped by the head: ${JSON.stringify(R.valueDropped)}`);
}
for (const [s, n] of real.sort((a, b) => b[1] - a[1])) log(`  ${n}x ${s}`);
const failures = [...R.crashes];
// A mutant run stops at its first catch; every other run must finish all its sequences.
const stoppedOnCatch = !!R.mutant?.firstCatch && E.STOP_ON_CATCH !== '0';
if (R.counts.sequences < CONFIG.seqs && !stoppedOnCatch) failures.push(`ran ${R.counts.sequences} of ${CONFIG.seqs} sequences`);
if (!R.moduleChecks.old || !R.moduleChecks.neu) failures.push('no module check passed on one side');
// Outside a mutant run, every difference must have a cause the harness
// classifies (timestamps, error shape, tie order, main's staleness): a data or
// state difference left over fails the run.
if (!R.mutant) {
  const open = Object.entries(R.diffSignatures).filter(([k]) => /^[^|]*\|(diff|state)\|/.test(k));
  const n = open.reduce((a, [, c]) => a + c, 0);
  if (n) failures.push(`${n} unexplained differences in ${open.length} signatures`);
}
// A page load the harness retried and then finished is counted and kept; any
// other harness error means a comparison did not happen.
{
  const n = R.totals.harnessErrors - (R.harnessReloadRetries ?? 0);
  if (n > 0) failures.push(`${n} harness errors besides retried page loads`);
}
if (R.sqlFailures) failures.push(`${R.sqlFailures} out-of-band SQL writes failed or changed no rows`);
if (!R.collation || R.collation.error || R.collation.mismatches.length) failures.push(`collation check: ${JSON.stringify(R.collation).slice(0, 300)}`);
log(`collation: ${R.collation?.strings ?? 0} tie-key strings lowercase the same in PostgreSQL${R.collation?.mismatches?.length ? ` except ${R.collation.mismatches.length}` : ''}`);
if (R.optimism) {
  log(`optimism: ${R.optimism.scenarios.length} cases; checks ${JSON.stringify(R.optimism.checks)}; ${R.optimism.failures.length} failed`);
  if (R.optimism.oldStale.length) log(`optimism: main stale, head current in ${R.optimism.oldStale.length} cases: ${R.optimism.oldStale.map((x) => `${x.mode}-${x.op}`).join(", ")}`);
  for (const f of R.optimism.failures.slice(0, 20)) log(`  ${JSON.stringify(f).slice(0, 400)}`);
  if (R.optimism.failures.length) failures.push(`${R.optimism.failures.length} optimistic-state checks failed`);
  if (R.optimism.scenarios.length < 24) failures.push(`ran ${R.optimism.scenarios.length} of 24 optimism cases`);
} else if (CONFIG.optimism) failures.push('optimism phase did not run');
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
