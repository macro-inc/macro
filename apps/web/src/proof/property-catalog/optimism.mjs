// Optimistic states of the catalog writes, OLD (main: REST + TanStack) beside
// NEW (the head: GraphQL mutations through the normalized cache), each in its
// own account. run.mjs loads this with OPTIMISM=1 and hands it its helpers.
//
// Every write the hooks make runs in four ways:
//   pending  the write's request is held; the open readers are read while it is
//            in flight, then it is let through
//   failed   the write's request is held, then answered 500; the readers must
//            come back to what they showed before, with the hook's toast
//   offline  the browser goes offline (and every catalog write it sends fails as
//            a lost connection, which also covers the cache engine's worker,
//            whose requests `setOffline` does not reach), the write starts, the
//            browser comes back; the write must land once, after the reconnect
//   tabs     a second tab of the same account has the same readers open; it is
//            read while the write is pending (held) and after it settles
// Readers are summarized by what a person sees (names, values, order and the
// query state), so the two worlds compare without ids.

const PROPS_PATH = /(^|\/)properties(\/|$)/;
const MODULE_PATH = /^\/(src|node_modules|@)/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const STATE = ['isPending', 'isSuccess', 'isError', 'isPlaceholderData'];
const RESULT_BOUND_MS = 30000;

function isCatalogWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method())) return null;
  const p = new URL(req.url()).pathname;
  if (MODULE_PATH.test(p)) return null;
  if (PROPS_PATH.test(p)) return { kind: 'rest', what: `${req.method()} ${p.replace(/^.*?\/properties/, '/properties').replace(UUID, '<id>')}` };
  if (!/graphql/.test(p)) return null;
  let body;
  try {
    body = req.postDataJSON();
  } catch {
    return null;
  }
  const ops = (Array.isArray(body) ? body : [body]).filter((b) => typeof b?.query === 'string' && /(^|[\s}])mutation\b/.test(b.query.replace(/#[^\n\r]*/g, ' ')));
  return ops.length ? { kind: 'gql', what: ops.map((b) => b.operationName ?? '(unnamed)').join('+') } : null;
}

// What a reader shows: its query state and its rows, without ids or times.
// An option's value is `{ type, value }` on both sides.
const optValue = (o) => {
  const v = o?.value;
  return String(v && typeof v === 'object' ? v.value : (v ?? ''));
};
// Options of equal display order, each run sorted by value. The server orders
// such a run by value under the database's collation, which the cache does not
// reproduce while a write is pending (main kept a renamed option in place
// until its refetch, too); the place a write gives an option is what it can
// predict.
const orderOf = (o) => o?.display_order ?? o?.displayOrder;
function tiesByValue(opts) {
  const out = [];
  for (let i = 0; i < opts.length; ) {
    let j = i + 1;
    while (j < opts.length && orderOf(opts[j]) === orderOf(opts[i])) j++;
    out.push(...opts.slice(i, j).sort((a, b) => (optValue(a) < optValue(b) ? -1 : optValue(a) > optValue(b) ? 1 : 0)));
    i = j;
  }
  return out;
}
function rowsOf(kind, data, places = false) {
  if (!Array.isArray(data)) return data === undefined ? '(no data)' : '(not a list)';
  const values = (opts) => (places ? tiesByValue(opts) : opts).map(optValue);
  const list = (opts) => values(opts).join(', ');
  if (kind === 'defs')
    return data
      .map((e) => ({ d: e?.definition ?? e, opts: e?.property_options }))
      .filter(({ d }) => !d?.is_system)
      .map(({ d, opts }) => `${d?.display_name}${Array.isArray(opts) ? ` [${list(opts)}]` : ''}`);
  if (kind === 'opts') return values(data);
  if (kind === 'tags') return data.map((t) => `${t?.scope ?? t?.definition?.scope ?? '?'}: ${list(t?.options ?? [])}`);
  return '(unknown)';
}
function labelOf(id) {
  try {
    const k = JSON.parse(id);
    return k.k === 'defs' ? `defs ${k.scope}${k.includeOptions ? '+options' : ''}` : k.k;
  } catch {
    return id;
  }
}
function summarize(snap) {
  const out = {};
  for (const [id, r] of Object.entries(snap ?? {})) {
    if (id === 'callers') continue;
    const label = labelOf(id);
    const kind = label.split(' ')[0];
    out[label] = { state: STATE.filter((f) => r?.[f]).join(',') || 'idle', rows: rowsOf(kind, r?.data), places: rowsOf(kind, r?.data, true), error: !!r?.error };
  }
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Rows only: a reader that refetches shows its rows with another state.
const rowsOnly = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.rows]));
const sameRows = (a, b) => same(rowsOnly(a), rowsOnly(b));
// Rows with each run of equal display order sorted by value (see tiesByValue).
const placesOnly = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.places]));
const samePlaces = (a, b) => same(placesOnly(a), placesOnly(b));

export async function runOptimism(h) {
  const { CONFIG, R, log, sleep, login, openSide, loadHarness, ev, harnessError, firstLine, STAMP } = h;
  R.optimism = { scenarios: [], checks: {}, failures: [], oldStale: [], landMs: [], tieReorders: [] };
  const tag = `opt-${CONFIG.seed}-${STAMP}`;
  const email = (w) => `pc-opt-${tag}-${w}@opt-${tag}-${w}.fuzz.test`;

  async function world(w) {
    const side = w === 'o' ? 'old' : 'neu';
    const state = await login(email(w));
    const s = await openSide(state, side, `OPT-${side}`);
    // The interceptor: in `hold` a catalog write waits for the gate, then goes
    // on; in `fail` it waits for the gate, then gets a 500; `watch` records it.
    s.opt = { mode: 'pass', gate: Promise.resolve(), seen: [] };
    await s.ctx.route(
      (u) => !MODULE_PATH.test(new URL(u.toString()).pathname),
      async (r) => {
        const w2 = s.opt.mode === 'pass' ? null : isCatalogWrite(r.request());
        if (!w2) return r.fallback();
        s.opt.seen.push({ ...w2, at: Date.now(), mode: s.opt.mode });
        if (s.opt.mode === 'watch') return r.fallback();
        if (s.opt.mode === 'offline') return r.abort('internetdisconnected');
        const mode = s.opt.mode;
        await s.opt.gate;
        if (mode === 'hold') return r.fallback();
        return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify(w2.kind === 'gql' ? { errors: [{ message: 'Internal server error' }] } : { message: 'Internal server error' }) });
      }
    );
    // The second tab: the same browser profile, so on NEW the same cache engine.
    const page2 = await s.ctx.newPage();
    const s2 = { ...s, page: page2, label: `OPT-${side}-tab2`, netlog: [] };
    await loadHarness(s2);
    return { w, side, s, s2 };
  }

  const setup = async (W, name, vars) => {
    W.s.tap.mode = 'setup';
    try {
      const r = await ev(W.s, 'mutate', name, vars);
      if (!r.ok) harnessError(`optimism setup ${W.side} ${name}: ${r.message}`);
      return r;
    } finally {
      W.s.tap.mode = 'pass';
    }
  };
  const read = async (s) => summarize(await ev(s, 'snapshot'));
  // Settled, as a quiet snapshot; a pending write keeps the harness's own
  // settle busy, so a mid-write read waits for the rows to hold still instead.
  async function steady(s, ms = 2500) {
    const end = Date.now() + ms;
    let last = await read(s);
    let since = Date.now();
    while (Date.now() < end) {
      await sleep(100);
      const now = await read(s);
      if (!same(now, last)) {
        last = now;
        since = Date.now();
      } else if (Date.now() - since >= 400) break;
    }
    return last;
  }
  const settled = async (s) => {
    await ev(s, 'settle', 8000);
    return read(s);
  };
  async function until(f, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await f()) return true;
      await sleep(50);
    }
    return false;
  }
  const start = (s, name, vars) =>
    s.page.evaluate(([n, v]) => {
      window.__optDone = false;
      window.__optRun = window.__h.mutate(n, v).then((r) => ((window.__optDone = true), r));
    }, [name, vars]);
  const result = (s) =>
    s.page.evaluate((bound) => Promise.race([window.__optRun, new Promise((r) => setTimeout(() => r({ ok: false, unsettled: true }), bound))]), RESULT_BOUND_MS);
  // what the hook's callers see: success, the failure contract, the toasts (error codes are each transport's own)
  const brief = (r) => ({ ok: !!r?.ok, unsettled: !!r?.unsettled, toasts: (r?.toasts ?? []).map((t) => `${t.kind}: ${t.title}`), contract: r?.ok ? null : (r?.contract ?? null) });

  // The catalog as the account's server holds it, by REST, summarized the
  // same way: the truth a settled reader must show.
  async function truth(W) {
    const { defs, tags } = await ev(W.s, 'setup.catalog');
    return { defs: defs.ok ? rowsOf('defs', defs.value) : '(failed)', tags: tags.ok ? rowsOf('tags', tags.value) : '(failed)' };
  }

  // Writes the server answers (it names and places them): no optimistic row on either side.
  const SERVER_ANSWERED = { createDef: 'created by the server, which assigns its id and place' };

  // One write in one mode, in one world.
  async function once(W, mode, name, vars) {
    const { s, s2 } = W;
    const o = { pre: await settled(s), pre2: await settled(s2) };
    s.opt.seen = [];
    let release = () => {};
    s.opt.gate = new Promise((r) => (release = r));
    if (mode === 'offline') {
      s.opt.mode = 'offline';
      await s.ctx.setOffline(true);
      await start(s, name, vars);
      await sleep(1500);
      o.mid = await steady(s);
      o.mid2 = await steady(s2);
      o.settledOffline = await s.page.evaluate(() => window.__optDone);
      o.requestsOffline = s.opt.seen.length;
      s.opt.mode = 'watch';
      await s.ctx.setOffline(false);
      // TanStack resumes a paused write on the reconnect; the cache's queue
      // sends a queued write when its retry delay (1 s, doubling per failed
      // attempt) runs out, which an \`online\` wake does not shorten. Wait for
      // the write to reach the server before reading anything, and record how
      // long it took.
      const back = Date.now();
      o.landedAfterReconnect = await until(() => s.opt.seen.some((x) => x.mode !== 'offline'), 20000);
      o.landMs = o.landedAfterReconnect ? Date.now() - back : null;
    } else {
      s.opt.mode = mode === 'failed' ? 'fail' : 'hold';
      await start(s, name, vars);
      o.intercepted = await until(() => s.opt.seen.length > 0, 10000);
      o.mid = await steady(s);
      o.mid2 = await steady(s2);
      // let it through (or fail it); later requests of the same write pass,
      // or keep failing, the same way
      if (mode !== 'failed') s.opt.mode = 'watch';
      release();
    }
    o.res = brief(await result(s));
    s.opt.mode = 'pass';
    o.post = await settled(s);
    // the other tab: up to 5 s for the write to reach it
    const t0 = Date.now();
    o.tab2Live = await until(async () => sameRows(await read(s2), o.post), 5000);
    o.tab2Ms = o.tab2Live ? Date.now() - t0 : null;
    o.post2 = await read(s2);
    o.requests = s.opt.seen.map((x) => x.what);
    // the writes that reached the server: none of those failed for want of a connection
    o.landed = s.opt.seen.filter((x) => x.mode !== 'offline').length;
    // a cold mount of the same readers: what the server says now, through the hooks
    o.fresh = summarize((await ev(s, 'fresh', W.keys, 8000)).snap);
    o.truth = await truth(W);
    // a tab that missed the write starts the next case from the server again
    if (!o.tab2Live) {
      await loadHarness(W.s2);
      await ev(W.s2, 'setKeys', W.keys);
      await settled(W.s2);
    }
    return o;
  }

  const [O, N] = await Promise.all([world('o'), world('n')]);
  const WORLDS = [O, N];
  // Each world's own definition and tag, made through the hooks so both
  // worlds' readers learn of them the way the app does.
  const base = { display_name: `Opt ${tag}`, data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'Alpha' }, { display_order: 1, value: 'Beta' }] }, scope: 'user' };
  for (const W of WORLDS) {
    const d = await setup(W, 'createDef', { body: base });
    W.defId = d.value?.id ?? d.value?.definition?.id;
    // every case writes to this definition, so without it nothing below can run
    if (!d.ok || !W.defId) throw new Error(`optimism setup: ${W.side} could not create its definition: ${d.message ?? 'no id'}`);
    W.keys = [{ k: 'defs', scope: 'all', includeOptions: true }, { k: 'defs', scope: 'user', includeOptions: false }, { k: 'opts', id: W.defId }, { k: 'tags' }];
    await Promise.all([ev(W.s, 'setKeys', W.keys), ev(W.s2, 'setKeys', W.keys)]);
    await setup(W, 'createTag', { scope: 'user', value: 'Tag zero', color: '#FF0000' });
    await Promise.all([settled(W.s), settled(W.s2)]);
  }

  const opts = async (W) => (await ev(W.s, 'snapshot'))[JSON.stringify({ k: 'opts', id: W.defId })]?.data ?? [];
  const tagRows = async (W) => ((await ev(W.s, 'snapshot'))['{"k":"tags"}']?.data ?? []).flatMap((t) => (t.options ?? []).map((o) => ({ ...o, propertyDefinitionId: t.definition?.id ?? t.propertyDefinitionId ?? o.property_definition_id })));
  // Each case's write, and the setup it needs first (a target to change).
  const CASES = {
    addOption: async (W, id) => ['addOption', { propertyDefinitionId: W.defId, body: { type: 'select_string', option: { value: `Add ${id}`, display_order: 9 } } }],
    updateOption: async (W, id) => {
      await setup(W, 'addOption', { propertyDefinitionId: W.defId, body: { type: 'select_string', option: { value: `Old ${id}`, display_order: 8 } } });
      await settled(W.s);
      const o = (await opts(W)).find((x) => optValue(x) === `Old ${id}`);
      if (!o?.id) throw new Error('updateOption: the option to rename is not listed');
      return ['updateOption', { propertyDefinitionId: W.defId, optionId: o?.id, body: { value: `Renamed ${id}` } }];
    },
    deleteOption: async (W, id) => {
      await setup(W, 'addOption', { propertyDefinitionId: W.defId, body: { type: 'select_string', option: { value: `Gone ${id}`, display_order: 7 } } });
      await settled(W.s);
      const o = (await opts(W)).find((x) => optValue(x) === `Gone ${id}`);
      if (!o?.id) throw new Error('deleteOption: the option to delete is not listed');
      return ['deleteOption', { propertyDefinitionId: W.defId, optionId: o?.id }];
    },
    createDef: async (W, id) => ['createDef', { body: { display_name: `New ${id}`, data_type: { type: 'select_string', multi: false, options: [{ display_order: 0, value: 'x' }] }, scope: 'user' } }],
    deleteDef: async (W, id) => {
      const d = await setup(W, 'createDef', { body: { display_name: `Doomed ${id}`, data_type: { type: 'select_string', multi: false, options: [] }, scope: 'user' } });
      return ['deleteDef', { definitionId: d.value?.id ?? d.value?.definition?.id }];
    },
    createTag: async (W, id) => ['createTag', { scope: 'user', value: `Tag ${id}`, color: '#00AA88' }],
    updateTag: async (W, id) => {
      await setup(W, 'createTag', { scope: 'user', value: `Was ${id}`, color: '#7C3AED' });
      await settled(W.s);
      const t = (await tagRows(W)).find((x) => optValue(x) === `Was ${id}`);
      if (!t?.id || !t?.propertyDefinitionId) throw new Error('updateTag: the tag to rename is not listed');
      return ['updateTag', { propertyDefinitionId: t?.propertyDefinitionId, optionId: t?.id, body: { value: `Now ${id}` } }];
    },
    deleteTag: async (W, id) => {
      await setup(W, 'createTag', { scope: 'user', value: `Drop ${id}`, color: '#123456' });
      await settled(W.s);
      const t = (await tagRows(W)).find((x) => optValue(x) === `Drop ${id}`);
      if (!t?.id || !t?.propertyDefinitionId) throw new Error('deleteTag: the tag to delete is not listed');
      return ['deleteTag', { propertyDefinitionId: t?.propertyDefinitionId, optionId: t?.id }];
    },
  };
  const MODES = ['pending', 'failed', 'offline'];
  const check = (name, ok, detail) => {
    R.optimism.checks[name] = (R.optimism.checks[name] ?? 0) + 1;
    if (!ok) R.optimism.failures.push({ check: name, ...detail });
  };

  let n = 0;
  for (const mode of MODES)
    for (const [op, prepare] of Object.entries(CASES)) {
      const id = `${mode}-${op}-${++n}`;
      try {
        const [oc, nc] = await Promise.all(WORLDS.map(async (W) => once(W, mode, ...(await prepare(W, id)))));
        const sc = { mode, op, old: oc, neu: nc };
        const at = { mode, op };
        // the two worlds end alike: the result, the toasts, every reader, the server
        check('result and toasts as on main', same(oc.res, nc.res), { ...at, old: oc.res, neu: nc.res });
        // A settled reader shows what a cold mount shows. Main's live readers
        // can be stale where the head's are current: that is `oldStale`, not
        // a difference, and only when the head's settled readers equal its
        // own cold mount and both cold mounts agree.
        check('fresh readers as on main', sameRows(oc.fresh, nc.fresh), { ...at, old: oc.fresh, neu: nc.fresh });
        check('NEW settled readers are current', sameRows(nc.post, nc.fresh), { ...at, post: nc.post, fresh: nc.fresh });
        if (sameRows(oc.post, nc.post)) check('settled readers as on main', same(oc.post, nc.post), { ...at, old: oc.post, neu: nc.post });
        else if (!sameRows(oc.post, oc.fresh) && sameRows(nc.post, nc.fresh) && sameRows(oc.fresh, nc.fresh)) R.optimism.oldStale.push({ ...at, old: oc.post, oldFresh: oc.fresh });
        else check('settled readers as on main', false, { ...at, old: oc.post, neu: nc.post });
        check('server state as on main', same(oc.truth, nc.truth), { ...at, old: oc.truth, neu: nc.truth });
        // NEW's own contract
        check('NEW write settles', !nc.res.unsettled, { ...at, res: nc.res });
        if (mode === 'failed') {
          check('NEW rolls back a failed write', sameRows(nc.post, nc.pre), { ...at, pre: nc.pre, post: nc.post });
          check('NEW rolls back in the other tab', sameRows(nc.post2, nc.pre2), { ...at, pre: nc.pre2, post: nc.post2 });
        } else if (SERVER_ANSWERED[op]) {
          // the server names it and places it, so neither side shows it before the answer
          check('NEW shows nothing until the server answers, as on main', sameRows(nc.mid, nc.pre) && sameRows(oc.mid, oc.pre), { ...at, pre: nc.pre, mid: nc.mid, oldMid: oc.mid });
        } else {
          check('NEW shows the write while it is pending', !sameRows(nc.mid, nc.pre), { ...at, pre: nc.pre, mid: nc.mid });
          check('NEW pending state is the settled state', samePlaces(nc.mid, nc.post), { ...at, mid: nc.mid, post: nc.post });
          // the server placed it among options of equal display order by value
          if (samePlaces(nc.mid, nc.post) && !sameRows(nc.mid, nc.post)) R.optimism.tieReorders.push({ ...at, mid: rowsOnly(nc.mid), post: rowsOnly(nc.post) });
        }
        // offline: whether it waits or tries and fails, the write reaches the server once, after the reconnect
        if (mode === 'offline') {
          check('NEW lands the write once after the reconnect', nc.landed === 1, { ...at, offline: nc.requestsOffline, landed: nc.landed, requests: nc.requests });
          R.optimism.landMs.push({ op, old: oc.landMs, neu: nc.landMs });
        }
        R.optimism.scenarios.push(sc);
        log(`optimism ${id}: old ${oc.res.ok ? 'ok' : 'failed'}${oc.tab2Live ? ' tab2-live' : ''}, neu ${nc.res.ok ? 'ok' : 'failed'}${nc.tab2Live ? ` tab2-live ${nc.tab2Ms}ms` : ''}; pending shown old ${!sameRows(oc.mid, oc.pre)} neu ${!sameRows(nc.mid, nc.pre)}${mode === 'offline' ? `; landed after the reconnect old ${oc.landMs}ms neu ${nc.landMs}ms` : ''}`);
      } catch (e) {
        harnessError(`optimism ${id}: ${firstLine(e)}`);
        R.optimism.failures.push({ check: 'harness', mode, op, error: firstLine(e) });
        for (const W of WORLDS) {
          W.s.opt.mode = 'pass';
          await W.s.ctx.setOffline(false).catch(() => {});
        }
      }
    }
  for (const W of WORLDS) await W.s.ctx.close().catch(() => {});
}
