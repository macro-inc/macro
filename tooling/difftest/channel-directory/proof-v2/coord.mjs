// Differential coordinator: main (M) against the branch with the device cache
// (C) and without it (N), on the same data at the same time.
//
//   node coord.mjs read --seed S --out DIR [--viewers heavy,small,buckets,groups]
//                       [--concurrency 8] [--mutant KIND]
//   node coord.mjs seq  --seed S --out DIR --groups q01,q02 [--sequences 20]
//                       [--steps 20] [--live-ms 10000] [--mutant KIND]
//
// read: every viewer's three pages load; their rows are compared field by
//   field with the primary's REST list and /activity, then seeded specs
//   (ids, peers, section labels, picker searches, saved types) are evaluated
//   by every moved reader in all three trees and compared strictly.
// seq:  per group, three viewers with three pages each; random REST writes,
//   and after every step: read-after-write on the actor's pages, live
//   convergence on every page within --live-ms, and a strict comparison of
//   every page after reload, once the lagging replica has replayed the write.
import fs from 'node:fs';
import path from 'node:path';
import { launch, viewerPage, load, snapshot } from './pw.mjs';
import { restTruth, psql, primaryLsn, waitReplica, call } from './rest.mjs';
import { compareRows, truthRows, compareContract, summarizeContract } from './compare.mjs';
import { classifyContract, summarizeClassified, CAUSES } from './classify.mjs';
import { OPS, rng, hashSeed, drawOp, ODD_NAMES } from './ops.mjs';
import { loadGroup, readState } from './group-state.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const args = Object.fromEntries(
  process.argv.slice(3).reduce((pairs, value, index, all) => (value.startsWith('--') ? [...pairs, [value.slice(2), all[index + 1]?.startsWith('--') || all[index + 1] === undefined ? 'true' : all[index + 1]]] : pairs), [])
);
const phase = process.argv[2];
const SEED = Number(args.seed ?? 20261121);
const OUT = path.resolve(args.out ?? `runs/${phase}-${SEED}`);
const MUTANT = args.mutant ?? null;
const MODES = [['M', 'main'], ['C', 'branch'], ['N', 'branch']];
fs.mkdirSync(OUT, { recursive: true });
const log = (file, value) => fs.appendFileSync(path.join(OUT, file), `${JSON.stringify(value)}\n`);
// Why a branch page's DM lookup failed (the probe's diag, never compared).
const logDmErrors = (file, snaps, where) => {
  for (const [mode, snap] of Object.entries(snaps)) {
    const errors = snap?.diag?.dmErrors;
    if (errors && Object.keys(errors).length) log(file, { ...where, mode, errors });
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const note = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

async function pool(items, size, work) {
  const queue = [...items.entries()];
  const results = [];
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      results[next[0]] = await work(next[1], next[0]);
    }
  }));
  return results;
}

async function openTrio(browser, session, { mutant = MUTANT } = {}) {
  const trio = {};
  await Promise.all(MODES.map(async ([mode, tree]) => {
    const viewer = await viewerPage(browser, session, { tree, mode, mutant: tree === 'branch' ? mutant : null });
    viewer.loaded = await load(viewer);
    trio[mode] = viewer;
  }));
  return trio;
}
const closeTrio = (trio) => Promise.all(Object.values(trio).map((v) => v.context.close().catch(() => {})));
const reloadTrio = (trio) => Promise.all(Object.values(trio).map(async (v) => { v.loaded = await load(v, { reload: true }); }));

/** Branch-only diagnostics come out of the contract before comparing. */
function contractView(snap) {
  const perId = {};
  const lookups = {};
  for (const [id, value] of Object.entries(snap.perId ?? {})) {
    const { settled, lookup, ...rest } = value;
    perId[id] = rest;
    if (lookup !== undefined) lookups[id] = { lookup, settled };
  }
  return { ...snap, perId, lookups };
}

function compareTrio(truth, snaps, { contract = true } = {}) {
  const reference = truthRows(truth);
  const data = {};
  for (const mode of Object.keys(snaps)) data[`truth~${mode}`] = compareRows(reference, snaps[mode].rows ?? []);
  data['M~C'] = compareRows(snaps.M.rows ?? [], snaps.C.rows ?? []);
  data['M~N'] = compareRows(snaps.M.rows ?? [], snaps.N.rows ?? []);
  const out = { data };
  if (contract) {
    const views = Object.fromEntries(Object.entries(snaps).map(([mode, snap]) => [mode, contractView(snap)]));
    out.contract = { 'M~C': compareContract(views.M, views.C), 'M~N': compareContract(views.M, views.N) };
    out.lookups = { C: views.C.lookups, N: views.N.lookups };
  }
  return out;
}
const dataEqual = (summary) => summary.equal && summary.order;

// ------------------------------------------------------------------ coverage
const coverage = {};
const count = (dimension, value, by = 1) => {
  coverage[dimension] ??= {};
  coverage[dimension][value] = (coverage[dimension][value] ?? 0) + by;
};
const isBot = (id) => id.startsWith('bot|');
function classifyRow(row, viewer, ties) {
  const humans = row.participants.filter((p) => !isBot(p.user_id));
  const bots = row.participants.filter((p) => isBot(p.user_id));
  const kind = row.channel_type === 'direct_message'
    ? bots.length ? 'agent dm' : 'dm'
    : row.channel_type === 'private' && !row.name ? 'group dm'
      : row.channel_type === 'team' && row.auto_join_team ? 'team auto-join' : row.channel_type;
  const me = row.participants.find((p) => p.user_id === viewer);
  const name = row.name ?? '';
  const odd = [];
  if ([...name].length >= 200) odd.push('long name');
  if (/[\u0590-\u08ff]/.test(name)) odd.push('right-to-left');
  if (/\u200d/.test(name)) odd.push('joined emoji');
  if (/\u0301/.test(name)) odd.push('combining mark');
  if (/^\s|\s$/.test(name)) odd.push('edge whitespace');
  if (/^\d+$/.test(name)) odd.push('numeric name');
  if (/^(alpha|Alpha|ALPHA)$/.test(name)) odd.push('case variant');
  if (/['"\\]/.test(name)) odd.push('quotes');
  if (ties.get(row.updated_at) > 1) odd.push('timestamp tie');
  if (row.viewed_at === null) odd.push('null viewed_at');
  if (!row.latest_message) odd.push('no messages');
  return { kind, role: me?.role ?? 'none', bots: bots.length > 0, odd };
}


// ------------------------------------------------------------- last view truth
// What the activity tracker gets as lastViewedAt is checked against the
// viewer's own comms_activity row on the primary, for every id a spec opens:
// main read /activity (the 100 most recent), the branch the record or the
// server's channelViewedAt.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function viewTruth(userId, ids) {
  const uuids = ids.filter((id) => UUID.test(id));
  if (!uuids.length) return new Map();
  const viewer = userId.replaceAll("'", "''");
  const list = uuids.map((id) => `'${id}'`).join(',');
  const json = await psql(`select coalesce(json_object_agg(channel_id, viewed_at), '{}') from comms_activity where user_id = '${viewer}' and channel_id in (${list})`);
  return new Map(Object.entries(JSON.parse(json || '{}')));
}
const ms = (value) => (value === null || value === undefined ? null : Date.parse(value));

/** A channel's current participants on the primary, for the contact-facts class. */
async function currentMembers(channelId) {
  if (!UUID.test(channelId)) return null;
  return JSON.parse((await psql(`select coalesce(json_agg(user_id order by user_id), '[]') from comms_channel_participants where channel_id = '${channelId}' and left_at is null`)) || '[]');
}

/** Per mode, the ids whose lastViewedAt is not the primary's; and the M~C/M~N
 * lastViewedAt contract diffs where the branch has the primary's value, which
 * come out of the contract as main's errors. */
function checkLastViews(snaps, truth, result, ids, context) {
  const wrong = {};
  for (const [mode, snap] of Object.entries(snaps)) {
    for (const id of ids) {
      const got = snap.perId?.[id]?.lastViewedAt ?? null;
      const want = truth.get(id) ?? null;
      count(`last view truth (${mode})`, ms(got) === ms(want) ? 'equal' : want === null ? 'extra view' : got === null ? 'missing view' : 'other view');
      if (ms(got) !== ms(want)) (wrong[mode] ??= []).push({ id, got, want });
    }
    if (mode !== 'M') for (const status of Object.values(snap.diag?.lastViewed ?? {})) count(`last view settled (${mode})`, status);
  }
  for (const pair of ['M~C', 'M~N']) {
    const diffs = result.contract?.[pair];
    if (!diffs?.perId) continue;
    const branch = snaps[pair.slice(2)];
    diffs.perId = diffs.perId.filter((d) => {
      const match = /^perId\.([^.]+)\.lastViewedAt$/.exec(d.path);
      if (!match) return true;
      const id = match[1];
      const want = ms(truth.get(id) ?? null);
      if (ms(branch.perId?.[id]?.lastViewedAt ?? null) !== want) return true;
      count('last view: main wrong, branch = primary', pair);
      log('lastview-main-wrong.jsonl', { ...context, pair, id, main: snaps.M.perId?.[id]?.lastViewedAt ?? null, primary: truth.get(id) ?? null });
      return false;
    });
    if (!diffs.perId.length) delete diffs.perId;
  }
  return wrong;
}
// ------------------------------------------------------------------ read phase
async function viewerContext(session) {
  const viewer = session.userId.replaceAll("'", "''");
  const json = await psql(`select json_build_object(
    'team', (select team_id from team_user where user_id = '${viewer}'),
    'left', coalesce((select json_agg(channel_id) from (select p.channel_id from comms_channel_participants p where p.user_id = '${viewer}' and p.left_at is not null and not exists (select 1 from comms_channel_participants q where q.channel_id = p.channel_id and q.user_id = p.user_id and q.left_at is null) order by md5(p.channel_id::text) limit 15) l), '[]'),
    'unjoinedPublic', coalesce((select json_agg(id) from (select c.id from comms_channels c where c.channel_type = 'public' and not exists (select 1 from comms_channel_participants p where p.channel_id = c.id and p.user_id = '${viewer}' and p.left_at is null) order by md5(c.id::text) limit 15) u), '[]'),
    'unjoinedTeam', coalesce((select json_agg(id) from (select c.id from comms_channels c where c.team_id = (select team_id from team_user where user_id = '${viewer}') and not exists (select 1 from comms_channel_participants p where p.channel_id = c.id and p.user_id = '${viewer}' and p.left_at is null) order by md5(c.id::text) limit 15) t), '[]'))`);
  return JSON.parse(json);
}

function uuidLike(r) {
  const hex = (n) => Array.from({ length: n }, () => r.int(0, 15).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-7${hex(3)}-${r.pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
}

function genSpec(r, ctx, index) {
  const rows = ctx.rows;
  const present = r.sample(rows, r.int(0, Math.min(25, rows.length))).map((row) => row.id);
  const absent = [];
  const add = (kind, ids) => { if (ids.length && r.chance(0.5)) { const id = r.pick(ids); absent.push(id); count('lookup: absent', kind); } };
  add('left (revoked)', ctx.absent.left);
  add('unjoined public', ctx.absent.unjoinedPublic);
  add('unjoined team', ctx.absent.unjoinedTeam);
  if (r.chance(0.3)) { absent.push(uuidLike(r)); count('lookup: absent', 'deleted or never existed'); }
  if (r.chance(0.05)) { absent.push('not-a-uuid'); count('lookup: absent', 'malformed id'); }
  for (const id of present) {
    const c = ctx.classes.get(id);
    count('lookup: kind', c.kind);
    count('lookup: viewer role', c.role);
    if (c.bots) count('lookup: kind', 'has bot participant');
    for (const odd of c.odd) count('odd values', odd);
  }
  const participants = [...new Set(rows.flatMap((row) => row.participants.map((p) => p.user_id)))];
  const peers = r.sample([...participants.filter((p) => p !== ctx.viewer), ctx.viewer, 'macro|gqlchan-p2599@example.com'], r.int(0, 4));
  // Bots are a few of anyone's participants; sample one often enough to count.
  const bots = participants.filter(isBot);
  if (bots.length && r.chance(0.5)) peers.push(r.pick(bots));
  for (const peer of peers) count('peers', peer === ctx.viewer ? 'self' : isBot(peer) ? 'bot' : 'person');
  const labels = Array.from({ length: r.int(1, 3) }, () => {
    const label = { channelIds: r.sample(rows, r.int(0, Math.min(8, rows.length))).map((row) => row.id) };
    const roll = r.next();
    if (roll < 0.35 && ctx.team) { label.teamId = ctx.team; count('section labels', 'viewer team'); }
    else if (roll < 0.45) { label.teamId = uuidLike(r); count('section labels', 'other team'); }
    else count('section labels', 'personal');
    if (r.chance(0.5)) label.channelCount = r.int(0, 3);
    return label;
  });
  const named = rows.filter((row) => row.name);
  const pickerSearch = Array.from({ length: r.int(1, 3) }, () => {
    const roll = r.next();
    if (roll < 0.15) { count('picker search', 'empty'); return ''; }
    if (roll < 0.25) { count('picker search', 'no match'); return 'zq-no-such-channel'; }
    if (roll < 0.35) { count('picker search', 'odd value'); return r.pick(ODD_NAMES).slice(0, r.int(1, 6)); }
    if (!named.length) { count('picker search', 'empty'); return ''; }
    const name = [...r.pick(named).name];
    const start = r.int(0, Math.max(0, name.length - 2));
    count('picker search', 'substring');
    return name.slice(start, start + r.int(1, 5)).join('');
  });
  const savedTypes = r.sample([null, 'public', 'private', 'team', 'direct_message', 'bogus', 'channel'], r.int(1, 4));
  const open = r.chance(0.5);
  const facts = r.chance(0.2);
  if (open) count('readers', 'open sections');
  if (facts) count('readers', 'contact facts');
  count('readers', 'per-id and lists');
  return { ids: [...present, ...absent], peers, labels, pickerSearch, savedTypes, open, facts, groups: true, rows: false, lists: true, index };
}

function readViewers() {
  const which = new Set((args.viewers ?? 'heavy,small,buckets,groups').split(','));
  const v1 = JSON.parse(fs.readFileSync(path.join(here, '../sessions.json'), 'utf8'));
  const v2 = JSON.parse(fs.readFileSync(path.join(here, 'sessions-v2.json'), 'utf8'));
  const out = [];
  if (which.has('heavy')) out.push({ session: v1[0], label: 'heavy', size: 'heavy (14,995)', specs: 12 });
  if (which.has('small')) for (const s of v1.slice(1)) out.push({ session: s, label: s.email.split('@')[0], size: 'small (67-134)', specs: 20 });
  if (which.has('buckets')) for (const s of v2.filter((s) => s.email.startsWith('gqlv2-b-'))) out.push({ session: s, label: s.email.split('@')[0], size: `bucket ${Number(s.email.slice(8, 12))}`, specs: 40 });
  if (which.has('groups')) for (const s of v2.filter((s) => /^gqlv2-[ql]-/.test(s.email))) out.push({ session: s, label: s.email.split('@')[0], size: 'group (~10)', specs: 10 });
  if (args.limit) return out.slice(0, Number(args.limit));
  return out;
}

async function readPhase() {
  const viewers = readViewers();
  const contractSummary = {};
  const dataSummary = {};
  const totals = { viewers: 0, specs: 0, perIdComparisons: 0, contractDiffs: 0, classified: 0, dataDiffs: 0, loadFailures: 0, lastViewWrong: {} };
  const classifiedSummary = {};
  const browsers = [];
  await pool(viewers, Number(args.concurrency ?? 8), async (entry, index) => {
    const browser = browsers[index % Number(args.concurrency ?? 8)] ??= await launch();
    const r = rng(hashSeed(SEED, entry.label));
    const truthBefore = await restTruth(entry.session);
    let trio;
    try {
      trio = await openTrio(browser, entry.session);
    } catch (error) {
      totals.loadFailures++;
      log('read.jsonl', { viewer: entry.label, error: String(error).slice(0, 400) });
      return;
    }
    const snaps = Object.fromEntries(await Promise.all(Object.entries(trio).map(async ([mode, v]) => [mode, await snapshot(v, { rows: true, lists: false })])));
    const truth = await restTruth(entry.session);
    const rowsCompare = compareTrio(truth, snaps, { contract: false });
    const truthMoved = JSON.stringify(truthBefore.rows.map((r) => r.id)) !== JSON.stringify(truth.rows.map((r) => r.id));
    count('viewer size', entry.size);
    count('rows compared (data)', entry.size, truth.rows.length);
    for (const [pair, summary] of Object.entries(rowsCompare.data)) {
      if (dataEqual(summary)) continue;
      totals.dataDiffs++;
      dataSummary[pair] ??= [];
      dataSummary[pair].push({ viewer: entry.label, missing: summary.missing.slice(0, 5), extra: summary.extra.slice(0, 5), order: summary.order, fields: summary.fields });
    }
    const ctx = await viewerContext(entry.session);
    const ties = new Map();
    for (const row of truth.rows) ties.set(row.updated_at, (ties.get(row.updated_at) ?? 0) + 1);
    const reference = truthRows(truth);
    const specCtx = { rows: reference, viewer: entry.session.userId, team: ctx.team, absent: ctx, classes: new Map(reference.map((row) => [row.id, classifyRow(row, entry.session.userId, ties)])) };
    for (let k = 0; k < entry.specs; k++) {
      const spec = genSpec(r, specCtx, k);
      const specSnaps = Object.fromEntries(await Promise.all(Object.entries(trio).map(async ([mode, v]) => [mode, await snapshot(v, spec)])));
      logDmErrors('dm-errors.jsonl', specSnaps, { viewer: entry.label, spec: k });
      const result = compareTrio(truth, Object.fromEntries(Object.entries(specSnaps).map(([m, s]) => [m, { ...s, rows: snaps[m].rows }])));
      const views = await viewTruth(entry.session.userId, spec.ids);
      const wrong = checkLastViews(specSnaps, views, result, spec.ids, { viewer: entry.label, spec: k });
      for (const [mode, list] of Object.entries(wrong)) {
        totals.lastViewWrong[mode] = (totals.lastViewWrong[mode] ?? 0) + list.length;
        log("lastview-wrong.jsonl", { viewer: entry.label, spec: k, mode, list });
      }
      totals.specs++;
      totals.perIdComparisons += spec.ids.length;
      for (const [pair, raw] of Object.entries(result.contract)) {
        const { kept: diffs, classified } = await classifyContract(raw, { viewer: entry.session.userId, mainFacts: specSnaps.M.facts?.facts, members: currentMembers });
        if (classified.length) {
          totals.classified += classified.length;
          summarizeClassified(classified, (classifiedSummary[pair] ??= {}), { viewer: entry.label, spec: k });
          log('classified.jsonl', { viewer: entry.label, spec: k, pair, classified });
        }
        if (!Object.keys(diffs).length) continue;
        totals.contractDiffs++;
        summarizeContract(diffs, (contractSummary[pair] ??= {}), { viewer: entry.label, spec: k });
        log('read-diffs.jsonl', { viewer: entry.label, spec: k, pair, specIds: spec.ids, diffs });
      }
      for (const [mode, lookups] of Object.entries(result.lookups)) {
        for (const [id, l] of Object.entries(lookups)) {
          const inTruth = specCtx.classes.has(id);
          count(`branch lookup (${mode})`, `${inTruth ? 'listed' : 'absent'} → ${l.lookup}/${l.settled}`);
        }
      }
    }
    totals.viewers++;
    log('read.jsonl', { viewer: entry.label, size: entry.size, rows: truth.rows.length, truthMoved, loaded: Object.fromEntries(Object.entries(trio).map(([m, v]) => [m, v.loaded])), data: Object.fromEntries(Object.entries(rowsCompare.data).map(([k, v]) => [k, dataEqual(v) ? 'equal' : { missing: v.missing.length, extra: v.extra.length, order: v.order, fields: Object.keys(v.fields) }])), errors: Object.fromEntries(Object.entries(trio).map(([m, v]) => [m, v.errors.slice(0, 3)])) });
    note(`read ${entry.label}: ${truth.rows.length} rows, ${entry.specs} specs, data ${Object.values(rowsCompare.data).every(dataEqual) ? 'equal' : 'DIFF'}`);
    await closeTrio(trio);
  });
  await Promise.all(browsers.map((b) => b?.close()));
  const summary = { phase, seed: SEED, mutant: MUTANT, totals, coverage, dataSummary, contractSummary, classifiedSummary, causes: CAUSES, commits: commits() };
  fs.writeFileSync(path.join(OUT, 'read-summary.json'), JSON.stringify(summary, null, 2));
  note(`read done: ${JSON.stringify(totals)}`);
}

function commits() {
  const read = (which) => { try { return fs.readFileSync(path.join(process.env.HOME, `.cache/gqlchan-bundles/proof-${which}/.proof-commit`), 'utf8').trim(); } catch { return null; } };
  return { main: read('main'), branch: read('branch') };
}

// ------------------------------------------------------------------ sequences
const LIVE_MS = Number(args['live-ms'] ?? 10_000);
const POLL_MS = 300;

// Ops the app itself performs on a writing page; the rest come from outside.
const IN_APP = new Set(['create', 'rename', 'delete', 'add', 'remove', 'join', 'dm', 'groupDm', 'botAdd', 'botRemove', 'botDm', 'message', 'autoJoin', 'convert']);
const RAW_MS = Number(args['raw-ms'] ?? 5000);
const stats = (values) => {
  if (!values?.length) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
};

/** Per page: converged within LIVE_MS or not. A live regression is a viewer
 * whose main page converged while a branch page of the same viewer did not. */
function classifyLive(result, opName, totals) {
  const byViewer = {};
  for (const [key, value] of Object.entries(result)) {
    const [v, mode] = key.split(':');
    (byViewer[v] ??= {})[mode] = value;
    const converged = value && !value.timeout && !value.pending;
    count(`live (${mode})`, converged ? 'converged' : 'not within bound');
    if (converged) (totals.liveMs[mode] ??= []).push(value.ms);
    else totals.liveTimeouts[mode] = (totals.liveTimeouts[mode] ?? 0) + 1;
  }
  for (const [v, modes] of Object.entries(byViewer)) {
    const converged = (m) => modes[m] && !modes[m].timeout && !modes[m].pending;
    if (!converged('M')) continue;
    for (const m of ['C', 'N']) {
      if (!modes[m] || converged(m)) continue;
      totals.liveRegressions.push({ op: opName, viewer: v, mode: m });
      count('live regression (main converged, branch not)', `${opName} ${m}`);
    }
  }
}

async function rowsOf(viewer) {
  return (await snapshot(viewer, { rows: true, lists: false })).rows ?? [];
}

/** Polls every page until its rows equal its viewer's truth, or the bound. */
async function live(pages, truths, refreshTruth, startedAt) {
  const result = {};
  const pending = new Set(pages.map((p) => p.key));
  let lastTruth = Date.now();
  while (pending.size && Date.now() - startedAt < LIVE_MS) {
    if (Date.now() - lastTruth > 1000) { await refreshTruth(); lastTruth = Date.now(); }
    await Promise.all(pages.filter((p) => pending.has(p.key)).map(async (p) => {
      const rows = await rowsOf(p.viewer).catch(() => null);
      if (!rows) return;
      const summary = compareRows(truthRows(truths[p.user]), rows);
      if (summary.equal) {
        result[p.key] = { ms: Date.now() - startedAt, order: summary.order };
        pending.delete(p.key);
      } else result[p.key] = { pending: true, missing: summary.missing.length, extra: summary.extra.length, fields: Object.keys(summary.fields) };
    }));
    // M pages never update live; stop waiting once every branch page settled.
    if ([...pending].every((key) => key.endsWith(':M'))) break;
    await sleep(POLL_MS);
  }
  for (const key of pending) result[key] = { ...(result[key] ?? {}), timeout: true };
  return result;
}

function stepSpec(r, state, group, touched) {
  const all = [...state.channels.keys()];
  const ids = [...new Set([...touched, ...r.sample(all, Math.min(6, all.length)), ...r.sample([...group.deleted], Math.min(2, group.deleted.size))])];
  const peers = [...group.viewers, r.pick(group.pool), `bot|${group.bot}`];
  const labels = [{ channelIds: r.sample(all, r.int(0, 4)), teamId: group.team, channelCount: r.int(0, 2) }, { channelIds: r.sample(all, r.int(0, 4)) }];
  const named = [...state.channels.values()].filter((c) => c.name);
  const pickerSearch = ['', named.length ? [...r.pick(named).name].slice(0, r.int(1, 4)).join('') : 'ops'];
  return { ids, peers, labels, pickerSearch, open: true, facts: r.chance(0.25), groups: true, rows: false, lists: true };
}

async function recordInApp(viewer, id, session, before) {
  await viewer.page.evaluate((channelId) => window.__proof.recordView(channelId), id);
  const started = Date.now();
  while (Date.now() - started < 8000) {
    const activity = await call(session, '/dss/channels/activity');
    const row = (activity.body ?? []).find((a) => a.channel_id === id);
    if (row && row.viewed_at !== before) return { status: 200, ms: Date.now() - started };
    await sleep(250);
  }
  return { status: 'no activity write within 8 s' };
}

async function groupRun(label) {
  const kind = label[0];
  const number = Number(label.slice(1));
  const group = loadGroup(kind, number);
  group.deleted = new Set();
  const browser = await launch();
  const trios = [];
  for (const session of group.sessions) trios.push(await openTrio(browser, session));
  const pages = trios.flatMap((trio, v) => Object.entries(trio).map(([mode, viewer]) => ({ key: `v${v + 1}:${mode}`, user: group.viewers[v], viewer, mode, v })));
  const totals = { sequences: 0, steps: 0, refused: 0, rawDiffs: 0, liveTimeouts: {}, liveMs: {}, liveRegressions: [], reloadDataDiffs: 0, reloadContractDiffs: 0, classified: 0, lastViewWrong: {} };
  const contractSummary = {};
  const classifiedSummary = {};
  const sequences = Number(args.sequences ?? 20);
  const steps = Number(args.steps ?? 20);
  for (let s = 0; s < sequences; s++) {
    const r = rng(hashSeed(SEED, label, s));
    for (let step = 0; step < steps; step++) {
      const state = await readState(group);
      const name = drawOp(r);
      const op = OPS[name];
      const actorIndex = r.int(0, 2);
      const actor = group.viewers[actorIndex];
      const session = group.sessions[actorIndex];
      const a = op.choose(r, state, actor);
      if (!a) { step--; continue; }
      const truths = {};
      const refreshTruth = async () => { await Promise.all(group.sessions.map(async (sess, i) => { truths[group.viewers[i]] = await restTruth(sess); })); };
      // 1. the write: in the app on one of the actor's pages (rotating M, C, N)
      //    through the app's own mutation hook; a leave or a role change has no
      //    in-app route and is written from outside, as another client would.
      const writer = op.inApp ? a.page : IN_APP.has(name) ? r.pick(['M', 'C', 'N']) : null;
      const t0 = Date.now();
      let res;
      if (op.inApp) {
        const before = (await call(session, '/dss/channels/activity')).body?.find((x) => x.channel_id === a.id)?.viewed_at ?? null;
        res = await recordInApp(trios[actorIndex][a.page], a.id, session, before);
      } else if (writer) {
        const inAppArgs = { ...a, team: state.team, oldName: state.channels.get(a.id)?.name ?? '' };
        res = await trios[actorIndex][writer].page.evaluate(([kind, args]) => window.__proof.write(kind, args), [name, inAppArgs]);
      } else res = await op.run(session, a, state);
      const resolvedAt = Date.now();
      const lsn = await primaryLsn();
      if (res.created) { group.known.add(res.created); group.created.add(res.created); }
      if (name === 'delete' && res.status < 300) group.deleted.add(a.id);
      const refused = typeof res.status !== 'number' || res.status >= 300;
      if (refused) totals.refused++;
      await refreshTruth();
      // 2. read-after-write: the writing page, from the moment its mutation
      //    resolved, until its rows equal the primary's (bound RAW_MS)
      let raw = null;
      if (!refused && writer) {
        const viewer = trios[actorIndex][writer];
        let summary;
        for (;;) {
          summary = compareRows(truthRows(truths[actor]), await rowsOf(viewer));
          if (summary.equal || Date.now() - resolvedAt > RAW_MS) break;
          await sleep(100);
        }
        raw = { mode: writer, ms: Date.now() - resolvedAt, equal: summary.equal, order: summary.order, missing: summary.missing, extra: summary.extra, fields: Object.keys(summary.fields) };
        count(`read-after-write (${writer})`, summary.equal ? 'equal' : 'timeout');
        if (!summary.equal) totals.rawDiffs++;
      }
      // 3. live, on every other page: converged within LIVE_MS of the write
      const others = pages.filter((p) => !(p.v === actorIndex && p.mode === writer));
      const liveResult = name === 'role' ? { skipped: 'a role change has no live event' } : await live(others, truths, refreshTruth, t0);
      if (name !== 'role') classifyLive(liveResult, name, totals);
      // 4. once the replica has the write, reload every page and compare strictly
      const replicaWaitMs = await waitReplica(lsn, 60_000).catch((error) => String(error));
      await Promise.all(trios.map(reloadTrio));
      await refreshTruth();
      const after = await readState(group);
      const touched = [a.id, res.created].filter(Boolean);
      const spec = stepSpec(r, after, group, touched);
      const reload = {};
      for (const [v, trio] of trios.entries()) {
        const snaps = Object.fromEntries(await Promise.all(Object.entries(trio).map(async ([mode, viewer]) => [mode, await snapshot(viewer, { ...spec, rows: true })])));
        logDmErrors(`dm-errors-${label}.jsonl`, snaps, { seq: s, step, viewer: `v${v + 1}` });
        const result = compareTrio(truths[group.viewers[v]], snaps);
        const views = await viewTruth(group.viewers[v], spec.ids);
        const wrong = checkLastViews(snaps, views, result, spec.ids, { group: label, seq: s, step, viewer: `v${v + 1}` });
        for (const [mode, list] of Object.entries(wrong)) {
          totals.lastViewWrong[mode] = (totals.lastViewWrong[mode] ?? 0) + list.length;
          log(`lastview-wrong-${label}.jsonl`, { seq: s, step, viewer: `v${v + 1}`, mode, list });
        }
        const dataBad = Object.entries(result.data).filter(([, d]) => !dataEqual(d));
        const contractBad = [];
        for (const [pair, raw] of Object.entries(result.contract)) {
          const { kept, classified } = await classifyContract(raw, { viewer: group.viewers[v], mainFacts: snaps.M.facts?.facts, members: currentMembers });
          if (classified.length) {
            totals.classified += classified.length;
            summarizeClassified(classified, (classifiedSummary[pair] ??= {}), { group: label, seq: s, step, viewer: `v${v + 1}` });
            log(`classified-${label}.jsonl`, { seq: s, step, viewer: `v${v + 1}`, pair, classified });
          }
          if (Object.keys(kept).length) contractBad.push([pair, kept]);
        }
        if (dataBad.length) totals.reloadDataDiffs++;
        if (contractBad.length) totals.reloadContractDiffs++;
        for (const [pair, diffs] of contractBad) summarizeContract(diffs, (contractSummary[pair] ??= {}), { group: label, seq: s, step, viewer: `v${v + 1}` });
        reload[`v${v + 1}`] = {
          data: Object.fromEntries(dataBad.map(([pair, d]) => [pair, { missing: d.missing, extra: d.extra, order: d.order, fields: d.fields }])),
          contract: Object.fromEntries(contractBad.map(([pair, d]) => [pair, Object.values(d).flat().slice(0, 12)])),
        };
      }
      totals.steps++;
      count('ops', name);
      count('op outcome', `${name} ${refused ? 'refused' : 'applied'}`);
      log(`seq-${label}.jsonl`, { group: label, seq: s, step, op: name, actor: `v${actorIndex + 1}`, writer: writer ?? (name === "role" ? "sql" : "rest"), error: res.error, args: a, status: res.status, writeMs: Math.round(res.ms ?? 0), raw, live: liveResult, replicaWaitMs, reload, truthSizes: Object.fromEntries(group.viewers.map((u, i) => [`v${i + 1}`, truths[u].rows.length])) });
    }
    totals.sequences++;
    note(`${label} sequence ${s + 1}/${sequences}: ${JSON.stringify(totals)}`);
  }
  await browser.close();
  totals.liveMs = Object.fromEntries(Object.entries(totals.liveMs).map(([mode, values]) => [mode, stats(values)]));
  return { label, totals, contractSummary, classifiedSummary };
}

async function seqPhase() {
  const labels = (args.groups ?? 'q01').split(',');
  const results = await Promise.all(labels.map((label) => groupRun(label).catch((error) => ({ label, error: String(error?.stack ?? error).slice(0, 2000) }))));
  const summary = { phase, seed: SEED, mutant: MUTANT, liveMs: LIVE_MS, groups: results, coverage, causes: CAUSES, commits: commits() };
  fs.writeFileSync(path.join(OUT, 'seq-summary.json'), JSON.stringify(summary, null, 2));
  note(`seq done: ${JSON.stringify(results.map((r) => ({ label: r.label, totals: r.totals, error: r.error })))}`);
}

if (phase === 'read') await readPhase();
else if (phase === 'seq') await seqPhase();
else throw new Error('usage: coord.mjs read|seq ...');
// A group that failed leaves its browser open; every result is on disk by now.
process.exit(0);
