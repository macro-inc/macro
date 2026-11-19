// Direct API timings (no browser rendering) for the open-path reads, as alice, through the proxy.
// 25 calls each (first 5 dropped as warm-up), sequential. Writes results/server_probe.json with the
// time window so server.py can pull the matching Tempo spans.
const fs = require('node:fs'); const path = require('node:path');
const L = require('./lib.cjs');
const { execFileSync } = require('node:child_process');
const PSQL = '/nix/store/48ya21bqynykp51pm07f82svs3kspb42-postgresql-16.14/bin/psql';
const psql = (sql) => execFileSync(PSQL, [L.ENV.pg, '-At', '-c', sql], { encoding: 'utf8' });
// Per request kind: reset pg_stat_statements, make the calls, then read back every statement the
// stack ran in that window (this stack's database only; background jobs can add a few rows).
const statements = () => JSON.parse(psql(`select coalesce(json_agg(x order by total_ms desc), '[]') from (select calls, round(total_exec_time::numeric,2) total_ms, round(mean_exec_time::numeric,3) mean_ms, round(max_exec_time::numeric,2) max_ms, rows, shared_blks_hit, shared_blks_read, left(regexp_replace(query, '\\s+', ' ', 'g'), 300) query from pg_stat_statements where query !~* 'pg_stat_statements' and calls >= 20) x`));
const FX = JSON.parse(fs.readFileSync(path.join(L.HERE, 'fixture.json'), 'utf8'));
(async () => {
  const browser = await L.launch();
  const ctx = await L.newContext(browser, { storageState: await L.authState(browser, 'alice@seed.macro.local'), insecure: true });
  const out = { startedAt: Date.now(), kinds: [] };
  const sel = (o) => `?selection=${encodeURIComponent(JSON.stringify(o))}`;
  for (const size of ['small', 'medium', 'large']) {
    const c = FX.channels[size]; const base = `${L.BASE}/dss/messages/channel/${c.id}`;
    const first = await (await ctx.request.get(`${base}/timeline${sel({ limit: 50, direction: 'older', around: null, include_deleted_threads: false })}`)).json();
    const kinds = {
      timeline_latest_50: `${base}/timeline${sel({ limit: 50, direction: 'older', around: null, include_deleted_threads: false })}`,
      timeline_around_old_50: `${base}/timeline${sel({ limit: 50, direction: 'older', around: c.oldRoot.id, include_deleted_threads: false })}`,
      timeline_around_threadroot_50: `${base}/timeline${sel({ limit: 50, direction: 'older', around: c.threadReply.rootId, include_deleted_threads: false })}`,
      thread_biggest: `${base}/threads/${c.biggestThreads[0].rootId}`,
      resolve_item: `${base}/items/${c.threadReply.replyId}`,
      participants: `${L.BASE}/dss/channels/${c.id}/participants`,
    };
    if (first.next_cursor) kinds.timeline_older_100 = `${base}/timeline${sel({ limit: 100, direction: 'older', around: null, include_deleted_threads: false, cursor: first.next_cursor })}`;
    for (const [kind, url] of Object.entries(kinds)) {
      const ms = []; let bytes = 0, status = 0, entries = null; psql('select pg_stat_statements_reset()');
      for (let i = 0; i < 25; i++) {
        const t = process.hrtime.bigint(); const r = await ctx.request.get(url); const body = await r.body(); const dt = Number(process.hrtime.bigint() - t) / 1e6;
        status = r.status(); bytes = body.length; if (i >= 5) ms.push(dt);
        if (i === 0) { try { const b = JSON.parse(body.toString()); entries = b.entries ? b.entries.length : b.replies ? b.replies.length : Array.isArray(b) ? b.length : null; } catch (e) {} }
      }
      const st = statements();
      out.kinds.push({ size, kind, path: new URL(url).pathname, status, bytesUncompressed: bytes, entries, ...L.stats(ms), calls: 25, sqlStatements: st, sqlMeanMsPerRequest: Math.round(st.reduce((a, x) => a + Number(x.total_ms), 0) / 25 * 100) / 100, t0: Date.now() });
      L.log(size, kind, status, bytes, 'entries', entries, JSON.stringify(L.stats(ms)));
    }
  }
  out.finishedAt = Date.now();
  fs.writeFileSync(path.join(L.OUT, 'server_probe.json'), JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
