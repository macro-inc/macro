// Differential fuzz of the property catalog: the base commit's query modules
// (OLD, REST queryFns) against the PR head's (NEW, GraphQL readers), side by
// side in one browser on the local stack. See README.md for what it compares.
//
// Usage: node run.mjs   (configured by environment variables, see CONFIG)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
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
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
function sortKeys(x, mapString, key = '') {
  if (Array.isArray(x)) return x.map((v) => sortKeys(v, mapString, key));
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = sortKeys(x[k], mapString, k);
    return o;
  }
  return typeof x === 'string' && mapString ? mapString(x, key) : x;
}
const J = (x) => JSON.stringify(sortKeys(x));
// Only the row timestamps: an ISO-looking option value or name is compared as text.
const TS_KEY = /^(created|updated)_?at$/i;
const isoMs = (s, key) => (TS_KEY.test(key) && ISO.test(s) ? `@${Date.parse(s.replace(' ', 'T'))}` : s);
const JT = (x) => JSON.stringify(sortKeys(x, isoMs));
const lower = (s) => (typeof s === 'string' ? s.toLowerCase() : String(s ?? ''));

// The server orders definitions by LOWER(display_name) and options by
// (display_order, number_value, LOWER(string_value)) with no tiebreaker, so
// rows whose keys are equal come back in either order (on both paths). This
// key is what each list is ordered by; null for lists with no such order.
function tieKey(el) {
  if (!el || typeof el !== 'object' || Array.isArray(el)) return null;
  if (el.definition && typeof el.definition === 'object') return tieKey(el.definition);
  if ('display_name' in el) return `d:${lower(el.display_name)}`;
  if ('displayName' in el) return `d:${lower(el.displayName)}`;
  if ('display_order' in el) return `o:${el.display_order}|${el.number_value ?? ''}|${lower(el.string_value ?? '')}`;
  if ('displayOrder' in el) {
    const v = el.value && typeof el.value === 'object' ? el.value.value : (el.label ?? el.value);
    return `o:${el.displayOrder}|${lower(v)}`;
  }
  if ('label' in el) return `l:${lower(el.label)}`;
  if ('name' in el && 'path' in el) return `n:${lower(el.name)}`;
  return null;
}
const idOf = (el) => JSON.stringify(el?.definition?.id ?? el?.id ?? el);
// Sort each run of equal order keys by id: removes only tie order, never the
// order between rows whose keys differ.
function tieCanon(x) {
  if (Array.isArray(x)) {
    const xs = x.map(tieCanon);
    const keys = xs.map(tieKey);
    if (xs.length < 2 || keys.some((k) => k === null)) return xs;
    const out = [];
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j < xs.length && keys[j] === keys[i]) j++;
      out.push(...xs.slice(i, j).sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0)));
      i = j;
    }
    return out;
  }
  if (x && typeof x === 'object') {
    const o = {};
    for (const k of Object.keys(x)) o[k] = tieCanon(x[k]);
    return o;
  }
  return x;
}
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
// equal | timestamp-format | tie-order | diff
function classify(a, b) {
  if (J(a) === J(b)) return 'equal';
  if (JT(a) === JT(b)) return 'timestamp-format';
  if (JT(tieCanon(a)) === JT(tieCanon(b))) return 'tie-order';
  return 'diff';
}

// --------------------------------------------------------------- results ----
const R = {
  config: { ...CONFIG },
  commit: git('rev-parse', 'HEAD'),
  // The code under test is the web PR's head; the harness commit only adds this directory.
  prHead: E.PR_HEAD ?? 'f0a18fbd81b',
  identicalToPrHeadOutsideProof: git('diff', '--quiet', E.PR_HEAD ?? 'f0a18fbd81b', 'HEAD', '--', '.', ':(exclude)apps/web/src/proof') !== null,
  dssBinaryBuiltAt: (() => {
    try {
      return fs.statSync(path.join(ROOT, 'target/debug/document_storage_service')).mtime.toISOString();
    } catch {
      return null;
    }
  })(),
  oldModulesFrom: 'a03c481f726',
  startedAt: new Date().toISOString(),
  counts: { sequences: 0, steps: 0, rawCases: 0, readerComparisons: 0, callerComparisons: 0, reloads: 0, freshMounts: 0 },
  classes: {}, // level -> class -> n
  coverage: {},
  ops: {},
  rejections: {},
  traffic: {},
  settle: { samples: 0, maxMs: 0, timeouts: 0, buckets: {} },
  staleness: { byOp: {}, mismatches: 0 },
  visibility: { checks: 0, oldMissing: 0, newMissing: 0 },
  harnessErrors: [],
  diffs: [], // first 400 real differences with context
  diffSignatures: {}, // signature -> count
  examples: {}, // class -> first few examples
  mutant: CONFIG.mutant ? { name: CONFIG.mutant, applied: 0, caughtAt: null, caughtBy: {}, firstCatch: null } : null,
  load: CONFIG.load ? { pages: CONFIG.load, ops: 0, errors: 0 } : null,
};
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
let stepContext = {};
function record(level, kind, cls, a, b, extra = {}) {
  bump(R.classes, level, cls);
  if (cls === 'equal') return;
  const ex = (R.examples[`${level}:${cls}`] ??= []);
  // The first difference that survives normalization (timestamps, tie order).
  const norm = (x) => (x === undefined ? null : JSON.parse(JT(tieCanon(x))));
  const d = cls === 'diff' || cls === 'state' ? firstDiff(norm(a), norm(b)) : firstDiff(a, b);
  if (ex.length < 5) ex.push({ kind, ...stepContext, ...extra, diff: d });
  if (cls === 'diff' || cls === 'error-shape' || cls === 'state') {
    const sig = `${level}|${cls}|${kind.replace(/[0-9a-f-]{36}/g, '<id>')}|${(d?.path ?? '').replace(/\[\d+\]/g, '[]')}`;
    bump(R.diffSignatures, sig);
    if (R.diffs.length < 400) R.diffs.push({ level, kind, class: cls, ...stepContext, ...extra, diff: d });
    if (R.mutant && cls !== 'error-shape') {
      bump(R.mutant.caughtBy, level);
      if (!R.mutant.firstCatch) R.mutant.firstCatch = { level, kind, ...stepContext, diff: d };
    }
  }
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

async function login(email) {
  const ctx = await browser.newContext(CTX_OPTS);
  await baseRoutes(ctx);
  const page = await ctx.newPage();
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(`${CONFIG.base}/app/`, { waitUntil: 'load', timeout: 180000 });
      await page.getByText('Continue with email').first().click({ timeout: 180000 });
      await page.getByPlaceholder(/company\.com$/).fill(email);
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      const outcome = await Promise.race([
        page.waitForURL(/\/app\/(home|onboarding|component|welcome\/)/, { timeout: 90000 }).then(() => 'in', () => 'timeout'),
        page.getByText('unable to create user').waitFor({ timeout: 90000 }).then(() => 'refused', () => 'timeout'),
      ]);
      if (outcome === 'in') break;
      if (outcome === 'timeout') throw new Error('Timeout: no sign-in after 90 s');
      // Signup rate limit: wait for the hour to roll over, then try again.
      R.loginWaits = (R.loginWaits ?? 0) + 1;
      if (attempt >= 20) throw new Error(`signup still refused after ${attempt} waits`);
      log(`signup refused for ${email.split('@')[0]} (rate limit); waiting 5 min`);
      await sleep(300000);
    } catch (e) {
      if (attempt >= 20 || !/Timeout/.test(String(e.message))) throw e;
      log(`login retry ${email.split('@')[0]}: ${String(e.message).slice(0, 120)}`);
    }
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

const HARNESS = `${CONFIG.base}/src/proof/property-catalog/index.html`;
const OLD_MODULE = /\/src\/lib\/queries\/properties\/(definitions|options|tags)\.ts(\?.*)?$/;
// The properties service behind the local proxy (`/dss/properties/...`).
const PROPS_PATH = /^\/dss\/properties\//;

// One side (OLD or NEW) of one account: its own browser context and page.
async function openSide(storageState, side, label) {
  const ctx = await browser.newContext({ ...CTX_OPTS, storageState });
  await baseRoutes(ctx);
  const tap = { mode: 'pass', rec: [], queue: [], mismatches: [], mutantArmed: false };
  const old = side === 'old' || CONFIG.control;
  if (old)
    await ctx.route(OLD_MODULE, async (r) => {
      const u = new URL(r.request().url());
      u.pathname = u.pathname.replace(/\.ts$/, '.__old__.ts');
      await r.fulfill({ response: await r.fetch({ url: u.toString() }) });
    });
  // Writes to the properties service: recorded on NEW, replayed on OLD, so
  // each write reaches the server once and both sides see the same answer.
  await ctx.route((u) => PROPS_PATH.test(new URL(u.toString()).pathname), async (r) => {
    const req = r.request();
    if (req.method() === 'GET' || tap.mode === 'pass') return r.fallback();
    const u = new URL(req.url());
    const entry = { method: req.method(), path: u.pathname + u.search, body: req.postData() ?? null };
    if (tap.mode === 'record') {
      const resp = await r.fetch();
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
    return r.fulfill({ status: next.status, headers: next.headers, body: next.resp });
  });
  if (side === 'neu' && ['drop-row', 'swap-order', 'alter-field'].includes(CONFIG.mutant)) {
    const g = rng(CONFIG.seed * 7919 + label.length);
    await ctx.route(/\/graphql/, async (r) => {
      const req = r.request();
      let op = null;
      try {
        op = req.postDataJSON()?.operationName ?? null;
      } catch {}
      if (!op?.startsWith('PropertyCatalog') || !tap.mutantArmed || !g.chance(CONFIG.mutantRate)) return r.fallback();
      const resp = await r.fetch();
      const json = await resp.json();
      if (mutateResponse(json, CONFIG.mutant, g)) R.mutant.applied++;
      const headers = { ...resp.headers() };
      delete headers['content-encoding'];
      delete headers['content-length'];
      return r.fulfill({ status: resp.status(), headers, body: JSON.stringify(json) });
    });
  }
  // Which transport each side reads through: OLD must read REST only, NEW GraphQL only.
  ctx.on('request', (req) => {
    const p = new URL(req.url()).pathname;
    const role = old ? 'old side' : 'new side';
    if (PROPS_PATH.test(p) && req.method() === 'GET') bump(R.traffic, role, 'REST GET /properties');
    else if (/graphql/.test(p)) {
      let op = null;
      try {
        op = req.postDataJSON()?.operationName ?? null;
      } catch {}
      if (op?.startsWith('PropertyCatalog')) bump(R.traffic, role, `GraphQL ${op}`);
    }
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => harnessError(`${label}: pageerror ${String(e.message).slice(0, 200)}`));
  // Module loads that failed or errored, for diagnosing a page that never got ready.
  const note = (x) => {
    s.netlog ??= [];
    s.netlog.push(x);
    if (s.netlog.length > 40) s.netlog.shift();
  };
  page.on('requestfailed', (r) => note(`failed ${new URL(r.url()).pathname.slice(0, 90)} ${r.failure()?.errorText}`));
  page.on('response', (r) => r.status() >= 400 && /\/(src|node_modules|@)/.test(r.url()) && note(`${r.status()} ${new URL(r.url()).pathname.slice(0, 90)}`));
  page.on('console', (m) => m.type() === 'error' && !/Vite server|Failed to load resource/.test(m.text()) && note(`console ${m.text().slice(0, 120)}`));
  const s = { ctx, page, tap, side, label };
  await loadHarness(s);
  if (side === 'neu' && CONFIG.mutant === 'skip-live-update') await ev(s, 'mutant.skipLiveUpdate');
  return s;
}
// Load (or reload) the harness page. The dev server now and then leaves a
// reload without its modules; that is retried and recorded, never compared.
async function loadHarness(s) {
  for (let attempt = 1; ; attempt++) {
    s.netlog = [];
    try {
      await s.page.goto(HARNESS, { waitUntil: 'load', timeout: 300000 });
      await s.page.waitForFunction(() => window.__harnessReady && window.__h.authenticated() === true, null, { timeout: Number(E.READY_MS ?? 120000) });
      return;
    } catch (e) {
      const st = await s.page.evaluate(() => ({ ready: !!window.__harnessReady, auth: window.__h?.authenticated?.(), url: location.href, body: document.body.innerText.slice(0, 200) })).catch((x) => String(x));
      const msg = `${s.label}: harness not ready (attempt ${attempt}) ${JSON.stringify(st)}: ${e.message.slice(0, 100)}; last requests: ${JSON.stringify(s.netlog.slice(-8))}`;
      R.harnessReloadRetries = (R.harnessReloadRetries ?? 0) + 1;
      harnessError(msg);
      if (attempt >= 4) throw new Error(msg);
      log(msg.slice(0, 300));
    }
  }
}
function harnessError(msg) {
  if (R.harnessErrors.length < 200) R.harnessErrors.push(msg);
}
const ev = (s, fnPath, ...args) =>
  s.page.evaluate(
    ([p, a]) => {
      const f = p.split('.').reduce((o, k) => o[k], window.__h);
      return f(...a);
    },
    [fnPath, args]
  );

// Mutants for the response path: break the GraphQL answer the new code reads.
function mutateResponse(json, kind, g) {
  const user = json?.data?.user;
  if (!user) return false;
  const lists = [];
  if (Array.isArray(user.propertyDefinitions)) lists.push(user.propertyDefinitions);
  if (Array.isArray(user.propertyOptions)) lists.push(user.propertyOptions);
  for (const d of user.propertyDefinitions ?? []) if (Array.isArray(d?.options)) lists.push(d.options);
  for (const s of user.tagSets ?? []) if (Array.isArray(s?.options)) lists.push(s.options);
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (!nonEmpty.length) return false;
  const list = g.pick(nonEmpty);
  if (kind === 'drop-row') {
    list.splice(g.int(list.length), 1);
    return true;
  }
  if (kind === 'swap-order') {
    const sig = (x) => J(Object.fromEntries(Object.entries(x).filter(([k]) => !['id', '__typename', 'createdAt', 'updatedAt'].includes(k))));
    for (let i = 0; i < list.length; i++)
      for (let j = list.length - 1; j > i; j--)
        if (sig(list[i]) !== sig(list[j])) {
          [list[i], list[j]] = [list[j], list[i]];
          return true;
        }
    return false;
  }
  if (kind === 'alter-field') {
    const row = g.pick(list);
    const fields = Object.entries(row).filter(([k, v]) => !['id', '__typename'].includes(k) && (typeof v === 'string' || typeof v === 'number' || v === null));
    if (!fields.length) return false;
    const [k, v] = g.pick(fields);
    row[k] = typeof v === 'number' ? v + 1 : typeof v === 'string' && !ISO.test(v) ? `${v}·` : v === null ? '#010203' : v;
    return row[k] !== v;
  }
  return false;
}

// ------------------------------------------------------------ comparisons ----
const STATE_FIELDS = ['status', 'fetchStatus', 'isPending', 'isSuccess', 'isError', 'isFetched', 'isPlaceholderData', 'isLoading', 'failureCount'];
function compareReader(level, kind, a, b) {
  R.counts.readerComparisons++;
  if (!a || !b) {
    record(level, kind, 'state', a ?? null, b ?? null, { note: 'reader missing on one side' });
    return;
  }
  const sa = Object.fromEntries(STATE_FIELDS.map((k) => [k, a[k]]));
  const sb = Object.fromEntries(STATE_FIELDS.map((k) => [k, b[k]]));
  if (J(sa) !== J(sb)) {
    record(level, kind, 'state', sa, sb);
    return;
  }
  const cls = classify(a.data, b.data);
  if (cls !== 'equal') {
    record(level, `${kind}.data`, cls, a.data, b.data);
    return;
  }
  if (J(a.error) !== J(b.error)) record(level, `${kind}.error`, 'error-shape', a.error, b.error);
  else record(level, kind, 'equal');
}
function compareCallers(level, a, b) {
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
    R.counts.callerComparisons++;
    record(`${level}:caller`, `caller.${k}`, classify(a?.[k], b?.[k]), a?.[k], b?.[k]);
  }
}
function compareSnapshots(level, a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'callers') compareCallers(level, a[k], b[k]);
    else compareReader(level, `reader${k}`, a[k], b[k]);
  }
}
// Raw read case: the old queryFn and the new reader, back to back.
function outcome(x) {
  return x.ok ? { ok: true, value: x.value } : { ok: false, error: { class: x.error?.class, codes: x.error?.codes } };
}
function compareRaw(kind, oldR, newR) {
  R.counts.rawCases++;
  const A = outcome(oldR);
  const B = outcome(newR);
  if (A.ok !== B.ok) return record('raw', kind, 'diff', A, B);
  if (!A.ok) {
    bump(R.coverage, 'raw outcome', 'both errored');
    return record('raw', kind, J(A.error) === J(B.error) ? 'equal' : 'error-shape', A.error, B.error, { oldMessage: oldR.message, newMessage: newR.message });
  }
  bump(R.coverage, 'raw outcome', 'both ok');
  return record('raw', kind, classify(A.value, B.value), A.value, B.value);
}
async function rawCase(s, key) {
  if (key.k === 'defs') {
    cover('listing scope', key.scope);
    cover('listing includeOptions', key.includeOptions);
    cover('listing forEntityType', key.forEntityType ?? 'none');
    const a = { scope: key.scope, includeOptions: key.includeOptions, forEntityType: key.forEntityType };
    const [o, n] = await Promise.all([ev(s, CONFIG.control ? 'raw.old.list' : 'raw.old.list', a), ev(s, CONFIG.control ? 'raw.old.list' : 'raw.neu.list', a)]);
    if (o.ok) cover('listing size', sizeBucket(o.value.length));
    compareRaw(`defs:${key.scope}:${key.includeOptions ? 'opts' : 'plain'}:${key.forEntityType ?? '-'}`, o, n);
  } else if (key.k === 'opts') {
    cover('option target', key.why ?? 'visible');
    const [o, n] = await Promise.all([ev(s, 'raw.old.options', key.id), ev(s, CONFIG.control ? 'raw.old.options' : 'raw.neu.options', key.id)]);
    if (o.ok) cover('options size', sizeBucket(o.value.length));
    compareRaw(`opts:${key.why ?? 'visible'}`, o, n);
  } else {
    const [o, n] = await Promise.all([ev(s, 'raw.old.tags'), ev(s, CONFIG.control ? 'raw.old.tags' : 'raw.neu.tags')]);
    if (o.ok) cover('tag count', sizeBucket(o.value.reduce((t, set) => t + set.options.length, 0)));
    compareRaw('tags', o, n);
  }
}

// ---------------------------------------------------------------- catalog ----
// What the account can see now, read through the old REST client (the
// generator only needs ids; it never feeds the comparison).
async function catalog(s) {
  const [defs, tags] = await Promise.all([ev(s, 'raw.old.list', { scope: 'all', includeOptions: true }), ev(s, 'raw.old.tags')]);
  const list = defs.ok ? defs.value : [];
  return {
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
  const pair = { lane, generation, A, B, inTeam: false, teamCreated: false, bUserId: null, deleted: [], foreign: [] };
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
async function settleAll(pair) {
  const res = await Promise.all(sides(pair).map((s) => ev(s, 'settle', CONFIG.settleMs)));
  for (const t of res) {
    R.settle.samples++;
    R.settle.maxMs = Math.max(R.settle.maxMs, t.ms);
    if (t.timedOut) R.settle.timeouts++;
    bump(R.settle.buckets, t.ms < 250 ? '<250ms' : t.ms < 1000 ? '250ms-1s' : t.ms < 2500 ? '1-2.5s' : '2.5-5s');
  }
}
// After a step: live (open readers) OLD vs NEW, fresh (a cold load) OLD vs
// NEW, and within each side live vs fresh, whose staleness must match.
async function compareStep(pair, level, op) {
  await settleAll(pair);
  if (CONFIG.mutant === 'stale-cache') await Promise.all([pair.A.neu, pair.B.neu].map((s) => ev(s, 'mutant.restoreCache')));
  const keys = pair.keys;
  const [liveAo, liveAn, liveBo, liveBn] = await Promise.all(sides(pair).map((s) => ev(s, 'snapshot')));
  const fresh = await Promise.all(sides(pair).map((s) => ev(s, 'fresh', keys, CONFIG.settleMs)));
  R.counts.freshMounts += 4;
  const [frAo, frAn, frBo, frBn] = fresh.map((f) => f.snap);
  for (const [who, lo, ln, fo, fn] of [['A', liveAo, liveAn, frAo, frAn], ['B', liveBo, liveBn, frBo, frBn]]) {
    stepContext.account = who;
    compareSnapshots(`${level}:live`, lo, ln);
    compareSnapshots(`${level}:fresh`, fo, fn);
    // staleness: which keys differ live vs fresh, per side
    const stale = (live, fr) => Object.keys(fr).filter((k) => JT(tieCanon(k === 'callers' ? live[k] : live[k]?.data)) !== JT(tieCanon(k === 'callers' ? fr[k] : fr[k]?.data))).sort();
    const so = stale(lo, fo);
    const sn = stale(ln, fn);
    if (so.length) bump(R.staleness.byOp, `${op}:${who}`);
    if (J(so) !== J(sn)) {
      R.staleness.mismatches++;
      record(`${level}:staleness`, `stale keys ${who}`, 'diff', so, sn);
    } else record(`${level}:staleness`, `stale keys ${who}`, 'equal');
  }
  delete stepContext.account;
}

// One write, through the real mutation hooks: NEW performs it against the
// server, OLD replays NEW's recorded requests and responses.
async function write(pair, actor, name, vars) {
  const acct = pair[actor];
  if (CONFIG.mutant === 'stale-cache') await ev(acct.neu, 'mutant.takeCache');
  if (CONFIG.mutant === 'stale-cache' || CONFIG.mutant === 'skip-live-update') R.mutant.applied++;
  acct.neu.tap.mutantArmed = true;
  acct.neu.tap.rec = [];
  acct.neu.tap.mode = 'record';
  const n = await ev(acct.neu, 'mutate', name, vars);
  acct.neu.tap.mode = 'pass';
  // read-after-write: the old and new readers, right after the write returned
  const rawAfter = await readAfterWrite(acct.neu, name, vars, n);
  acct.old.tap.queue = [...acct.neu.tap.rec];
  acct.old.tap.mismatches = [];
  acct.old.tap.mode = 'replay';
  const o = await ev(acct.old, 'mutate', name, vars);
  acct.old.tap.mode = 'pass';
  if (acct.old.tap.queue.length || acct.old.tap.mismatches.length) harnessError(`replay ${name}: ${acct.old.tap.queue.length} unused, mismatches ${JSON.stringify(acct.old.tap.mismatches).slice(0, 300)}`);
  bump(R.ops, `${name}:${actor}`, n.ok ? 'ok' : 'rejected');
  if (!n.ok) {
    const why = (R.rejections[`${name}:${actor}`] ??= {});
    const msg = `${n.error?.class} ${JSON.stringify(n.error?.codes)} ${String(n.message).slice(0, 80)}`;
    why[msg] = (why[msg] ?? 0) + 1;
  }
  record('mutation-result', name, classify(o.ok ? o.value : o.error, n.ok ? n.value : n.error), o, n);
  return { n, rawAfter };
}
async function readAfterWrite(s, name, vars, result) {
  const keys = [{ k: 'defs', scope: 'all', includeOptions: true }, { k: 'tags' }];
  const defId = vars?.propertyDefinitionId ?? vars?.definitionId;
  if (defId) keys.push({ k: 'opts', id: defId, why: 'just written' });
  for (const key of keys) {
    stepContext.level = 'read-after-write';
    await rawCase(s, key);
  }
  delete stepContext.level;
  // visibility: the write is in both readers' answer right away
  if (result.ok && (name === 'createDef' || name === 'deleteDef')) {
    const id = name === 'createDef' ? (result.value?.id ?? result.value?.definition?.id) : vars.definitionId;
    const [o, n] = await Promise.all([ev(s, 'raw.old.list', { scope: 'all', includeOptions: false }), ev(s, 'raw.neu.list', { scope: 'all', includeOptions: false })]);
    const has = (x) => x.ok && x.value.some((d) => (d.definition?.id ?? d.id) === id);
    R.visibility.checks++;
    const want = name === 'createDef';
    if (has(o) !== want) R.visibility.oldMissing++;
    if (has(n) !== want) R.visibility.newMissing++;
  }
}

// A seeded operation over what the account can see.
async function step(pair, g, gen) {
  // B also acts after it was removed from the team: its team-scope writes must
  // be refused the same way on both sides.
  const actor = g.chance(0.3) ? 'B' : 'A';
  const acct = pair[actor];
  const cat = await catalog(acct.neu);
  cover('catalog size', sizeBucket(cat.defs.length));
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
  stepContext.op = op;
  stepContext.actor = actor;
  cover('op', op);
  cover('actor', actor === 'A' ? (pair.teamCreated ? 'team owner' : 'owner, no team') : pair.inTeam ? 'team member' : pair.teamCreated ? 'revoked member' : 'second user, no team');
  switch (op) {
    case 'createDef':
    case 'crmStage': {
      const scope = op === 'crmStage' ? 'team' : teamScope();
      if (op === 'crmStage' && !pair.inTeam) return write(pair, actor, 'createDef', { body: { display_name: gen.name(), data_type: gen.dataType(), scope: 'user' } });
      const body = op === 'crmStage'
        ? { display_name: 'Deal stage', data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'Lead' }, { display_order: 1, value: 'Won', color: '#00AA88' }] }, scope }
        : { display_name: gen.name(), data_type: gen.dataType(), scope };
      cover('created data type', body.data_type.type);
      cover('created scope', scope);
      if (/[^\x00-\x7f]/.test(body.display_name)) cover('odd value', 'unicode name');
      if (body.display_name.length > 60) cover('odd value', 'long name');
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
      cover('option write target', d.definition.is_system ? 'system definition' : 'own definition');
      const body = defType(d) === 'SELECT_NUMBER'
        ? { type: 'select_number', option: { value: gen.number(), display_order: gen.displayOrder() } }
        : { type: 'select_string', option: { value: gen.optString(), display_order: gen.displayOrder(), ...(g.chance(0.05) ? { color: g.pick(TAG_COLORS) } : {}) } };
      if (body.option.color === null) cover('odd value', 'null color');
      return write(pair, actor, 'addOption', { propertyDefinitionId: d.definition.id, body });
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
      cover('odd value', 'rename option');
      return write(pair, actor, 'updateOption', { propertyDefinitionId: d.definition.id, optionId: o.id, body });
    }
    case 'ensureTagSet':
      return write(pair, actor, 'ensureTagSet', { scope: teamScope() });
    case 'createTag': {
      const scope = teamScope();
      cover('tag scope', scope);
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
      cover('odd value', 'rename tag');
      return write(pair, actor, 'updateTag', { propertyDefinitionId: t.propertyDefinitionId, optionId: t.id, body });
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
      const ok = sql(`UPDATE property_definitions SET display_name = :'v', updated_at = now() WHERE id = :'id'`, { v: gen.name(), id: d.definition.id });
      bump(R.ops, 'sqlRename', ok ? 'ok' : 'rejected');
      cover('odd value', 'renamed definition');
      return null;
    }
    case 'sqlNullColor': {
      // A tag with no color: the API refuses one, but older rows and other writers have them.
      if (!tagOpts.length) return null;
      const t = g.pick(tagOpts);
      const ok = sql(`UPDATE property_options SET color = NULL, updated_at = now() WHERE id = :'id'`, { id: t.id });
      bump(R.ops, 'sqlNullColor', ok ? 'ok' : 'rejected');
      cover('odd value', 'null color');
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
      if (!pair.teamCreated) return (await teamCreate(pair, g)) && cover('team event', 'created + member joined'), null;
      if (pair.inTeam) return (await teamRevoke(pair)) && cover('team event', 'member revoked'), null;
      return (await teamJoin(pair)) && cover('team event', 'member re-joined'), null;
    }
  }
  return null;
}
function sql(statement, vars) {
  try {
    const args = ['exec', '-i', CONFIG.pg, 'psql', '-U', 'user', '-d', 'macrodb', '-q', '-v', 'ON_ERROR_STOP=1'];
    for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
    execFileSync('docker', args, { input: `${statement};\n`, stdio: ['pipe', 'ignore', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// Every listing key, every option id the account can name, and the tags.
async function sweep(pair, label) {
  const outer = stepContext;
  for (const acct of [pair.A, pair.B]) {
    stepContext = { lane: pair.lane, generation: pair.generation, level: `sweep:${label}`, account: acct.name };
    for (const lk of LIST_KEYS) await rawCase(acct.neu, { k: 'defs', ...lk });
    await rawCase(acct.neu, { k: 'tags' });
    const cat = await catalog(acct.neu);
    const ids = [...new Set([...cat.defs.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)])];
    for (const id of ids) await rawCase(acct.neu, { k: 'opts', id, why: cat.defs.find((d) => d.definition.id === id)?.definition.is_system ? 'system definition' : 'visible' });
    for (const id of pair.deleted.slice(-5)) await rawCase(acct.neu, { k: 'opts', id, why: 'deleted definition' });
    for (const id of pair.foreign) await rawCase(acct.neu, { k: 'opts', id, why: acct.name === 'B' ? 'own private definition' : "another user's private definition" });
    await rawCase(acct.neu, { k: 'opts', id: crypto.randomUUID(), why: 'random id' });
  }
  stepContext = outer;
}

async function runLane(lane, seqCount) {
  const g = rng(CONFIG.seed * 1000003 + lane * 7919);
  const gen = makeGen(g);
  let pair = null;
  for (let seq = 0; seq < seqCount; seq++) {
    if (!pair || seq % CONFIG.rotate === 0) {
      if (pair) {
        if (CONFIG.sweep) await sweep(pair, 'end');
        await closePair(pair);
      }
      pair = await newAccountPair(lane, Math.floor(seq / CONFIG.rotate));
      // empty account first, then (half the pairs) a team from the start
      stepContext = { lane, generation: pair.generation, seq, step: 0, op: 'empty' };
      await setKeys(pair, chooseKeys(g, await catalog(pair.A.neu), pair));
      await compareStep(pair, 'empty', 'empty');
      if (CONFIG.sweep) await sweep(pair, 'empty');
      if (g.chance(0.75)) await teamCreate(pair, g);
    }
    stepContext = { lane, generation: pair.generation, seq, step: 0, op: 'open' };
    await setKeys(pair, chooseKeys(g, await catalog(pair.A.neu), pair));
    await compareStep(pair, 'open', 'open');
    for (let st = 1; st <= CONFIG.steps; st++) {
      stepContext = { lane, generation: pair.generation, seq, step: st };
      await step(pair, g, gen);
      for (let i = 0; i < CONFIG.readsPerStep; i++) {
        const acct = g.chance(0.7) ? pair.A : pair.B;
        const cat = await catalog(acct.neu);
        const kind = g.weighted([['defs', 5], ['opts', 3], ['tags', 1]]);
        const ids = [...cat.selects.map((d) => d.definition.id), ...cat.tagSets.filter((t) => t.definition).map((t) => t.definition.id)];
        const key = kind === 'defs' ? { k: 'defs', ...g.pick(LIST_KEYS) } : kind === 'tags' || !ids.length ? { k: 'tags' } : { k: 'opts', id: g.pick(ids) };
        stepContext.level = 'random-read';
        await rawCase(acct.neu, key);
      }
      delete stepContext.level;
      await compareStep(pair, 'step', stepContext.op);
      R.counts.steps++;
    }
    // reload: a real page reload of every side, then the same readers again
    stepContext = { lane, generation: pair.generation, seq, step: 'reload' };
    await Promise.all(sides(pair).map((s) => loadHarness(s)));
    if (CONFIG.mutant === 'skip-live-update') await Promise.all([pair.A.neu, pair.B.neu].map((s) => ev(s, 'mutant.skipLiveUpdate')));
    R.counts.reloads += 4;
    await setKeys(pair, pair.keys);
    await compareStep(pair, 'reload', 'reload');
    R.counts.sequences++;
    log(`lane ${lane} seq ${seq + 1}/${seqCount}: steps ${R.counts.steps}, raw ${R.counts.rawCases}, differences ${R.diffs.length}`);
    flush();
    if (R.mutant?.firstCatch && E.STOP_ON_CATCH !== '0') break;
  }
  if (pair) {
    if (CONFIG.sweep) await sweep(pair, 'end');
    await closePair(pair);
  }
}

// Thousands of definitions, a definition with hundreds of options, hundreds of tags.
async function volumePhase() {
  log(`volume: ${CONFIG.volume} definitions`);
  const g = rng(CONFIG.seed * 31337);
  const gen = makeGen(g);
  const pair = await newAccountPair('V', 0);
  stepContext = { lane: 'V', level: 'volume' };
  const bodies = Array.from({ length: CONFIG.volume }, (_, i) => ({ body: { display_name: `${gen.name()} v${i % 700}`, data_type: g.chance(0.3) ? gen.dataType() : { type: 'string' }, scope: 'user' } }));
  const big = { body: { display_name: 'Big select', data_type: { type: 'select_string', multi: true, options: [] }, scope: 'user' } };
  const res = await pair.A.neu.page.evaluate(
    async ([bodies, big, nOpts, nTags]) => {
      const h = window.__h;
      let next = 0;
      let ok = 0;
      let rejected = 0;
      const worker = async () => {
        while (next < bodies.length) {
          const r = await h.setup.rest('createPropertyDefinition', bodies[next++]);
          r.ok ? ok++ : rejected++;
        }
      };
      await Promise.all(Array.from({ length: 16 }, worker));
      const b = await h.setup.rest('createPropertyDefinition', big);
      const id = b.value?.id ?? b.value?.definition?.id;
      for (let i = 0; i < nOpts; i += 16) await Promise.all(Array.from({ length: Math.min(16, nOpts - i) }, (_, j) => h.setup.rest('addPropertyOption', { definition_id: id, body: { type: 'select_string', option: { value: `${(i + j) % 2 ? 'Opt' : 'opt'} ${Math.floor((i + j) / 2)}`, display_order: (i + j) % 5 } } })));
      const set = await h.setup.rest('ensureTagSet', { body: { scope: 'user' } });
      const tagDef = set.value?.definition?.id;
      for (let i = 0; i < nTags; i += 16) await Promise.all(Array.from({ length: Math.min(16, nTags - i) }, (_, j) => h.setup.rest('addPropertyOption', { definition_id: tagDef, body: { type: 'select_string', option: { value: `${(i + j) % 2 ? 'Tag' : 'tag'} ${Math.floor((i + j) / 2)}`, display_order: (i + j) % 3, color: '#123456' } } })));
      return { ok, rejected, bigId: id, tagDef };
    },
    [bodies, big, 600, 300]
  );
  R.volume = { requested: CONFIG.volume, ...res };
  log(`volume: created ${res.ok}, rejected ${res.rejected}`);
  for (const lk of LIST_KEYS) await rawCase(pair.A.neu, { k: 'defs', ...lk });
  await rawCase(pair.A.neu, { k: 'tags' });
  await rawCase(pair.A.neu, { k: 'opts', id: res.bigId, why: 'definition with 600 options' });
  await rawCase(pair.A.neu, { k: 'opts', id: res.tagDef, why: 'tag set with 300 tags' });
  await setKeys(pair, [{ k: 'tags' }, { k: 'defs', scope: 'all', includeOptions: true }, { k: 'defs', scope: 'user', includeOptions: false }, { k: 'defs', scope: 'all', includeOptions: true, forEntityType: 'TASK' }, { k: 'opts', id: res.bigId }, { k: 'opts', id: res.tagDef }]);
  await compareStep(pair, 'volume', 'volume');
  for (let st = 1; st <= 20; st++) {
    stepContext = { lane: 'V', level: 'volume', step: st };
    await step(pair, g, gen);
    await compareStep(pair, 'volume', stepContext.op);
  }
  await closePair(pair);
}

// Concurrent load: other accounts writing and reading, and readers on the
// fuzzed accounts' server, while the differential runs.
const loadPages = [];
async function startLoad() {
  for (let i = 0; i < CONFIG.load; i++) {
    const st = await login(`pc-load-${CONFIG.seed}-${i}-${STAMP}@load-${CONFIG.seed}-${i}-${STAMP}.fuzz.test`);
    const s = await openSide(st, 'neu', `load${i}`);
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
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 2));
}

// ------------------------------------------------------------------- main ----
log(`seed ${CONFIG.seed}, ${CONFIG.seqs} sequences x ${CONFIG.steps} steps over ${CONFIG.lanes} lanes${CONFIG.mutant ? `, mutant ${CONFIG.mutant}` : ''}${CONFIG.control ? ', CONTROL (old vs old)' : ''}${CONFIG.load ? `, load ${CONFIG.load}` : ''} -> ${OUT}`);
const heartbeat = setInterval(flush, 30000);
try {
  if (CONFIG.load) await startLoad();
  const per = Array.from({ length: CONFIG.lanes }, (_, i) => Math.floor(CONFIG.seqs / CONFIG.lanes) + (i < CONFIG.seqs % CONFIG.lanes ? 1 : 0));
  await Promise.all(per.map((n, lane) => runLane(lane, n).catch((e) => harnessError(`lane ${lane} crashed: ${e.stack?.slice(0, 600)}`))));
  if (CONFIG.volume && !CONFIG.mutant) await volumePhase().catch((e) => harnessError(`volume crashed: ${e.stack?.slice(0, 600)}`));
  if (CONFIG.load) await stopLoad();
} finally {
  clearInterval(heartbeat);
  R.finishedAt = new Date().toISOString();
  flush();
  await browser.close();
}
const real = Object.entries(R.diffSignatures);
log(`done: ${R.counts.sequences} sequences, ${R.counts.steps} steps, ${R.counts.rawCases} raw cases, ${R.counts.readerComparisons} reader and ${R.counts.callerComparisons} caller comparisons; ${real.length} difference signatures; ${R.harnessErrors.length} harness errors`);
for (const [sig, n] of real.sort((a, b) => b[1] - a[1])) log(`  ${n}x ${sig}`);
if (R.mutant) log(`mutant ${R.mutant.name}: applied ${R.mutant.applied}, caught ${R.mutant.firstCatch ? `at ${JSON.stringify(R.mutant.firstCatch).slice(0, 300)}` : 'NO'}`);
