// Freshness observation: alice (receiver, browser on #freshness) and bob (sender, API calls from his
// own logged-in context, plus a second browser page kept open on the channel).
// Measures send -> receiver WS frame -> receiver DOM, and logs what the receiver's client does on
// new message / edit / delete / reaction / 30 s offline. Observational only.
// Usage: node ~/.cache/channels-perf/freshness.cjs [--n 15]
const fs = require('node:fs'); const path = require('node:path');
const L = require('./lib.cjs');
const N = Number((process.argv.indexOf('--n') >= 0 && process.argv[process.argv.indexOf('--n') + 1]) || 15);
const ch = L.ENV.channels.freshness; const api = `${L.BASE}/dss/messages/channel/${ch}`;
const out = { channel: ch, generatedAt: new Date().toISOString(), sends: [], events: {}, offline: {} };

(async () => {
  const browser = await L.launch();
  const actx = await L.newContext(browser, { storageState: await L.authState(browser, 'alice@seed.macro.local') });
  const bctx = await L.newContext(browser, { storageState: await L.authState(browser, 'bob@seed.macro.local'), insecure: true });
  await actx.addInitScript(L.PROBE);
  // Receiver-side DOM stamp: wall-clock time a message element containing a marker first becomes visible.
  await actx.addInitScript(() => {
    window.__seen = {}; window.__gone = {}; window.__textAt = {};
    const scan = () => {
      for (const n of document.querySelectorAll('[data-message-id]')) {
        const id = n.getAttribute('data-message-id');
        if (!(id in window.__seen)) window.__seen[id] = Date.now();
        const t = n.textContent || '';
        for (const k of Object.keys(window.__want || {})) if (!(k in window.__textAt) && t.includes(k)) window.__textAt[k] = Date.now();
      }
    };
    new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
    setInterval(scan, 10);
  });
  const apage = await actx.newPage(); const arec = await L.recorder(apage);
  const bpage = await bctx.newPage();
  await apage.goto(`${L.BASE}/app/channels/${ch}`); await bpage.goto(`${L.BASE}/app/channels/${ch}`);
  await apage.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 });
  await bpage.waitForSelector('[data-channel-scroll] [data-message-id]', { timeout: 90_000 });
  await L.sleep(8000);
  const j = async (r) => { const t = await r.text(); try { return { status: r.status(), body: JSON.parse(t) }; } catch { return { status: r.status(), body: t }; } };
  const want = (k) => apage.evaluate((k) => { window.__want = window.__want || {}; window.__want[k] = 1; }, k);
  const textAt = (k) => apage.evaluate((k) => window.__textAt[k] ?? null, k);
  const seenAt = (id) => apage.evaluate((id) => window.__seen[id] ?? null, id);
  // What the receiver did in [from, to]: HTTP requests and WS frames (pings dropped).
  const activity = (from, to) => ({
    requests: arec.requests().filter((r) => r.start >= from && r.start <= to && !L.isStatic(r.url)).map((r) => {
      const u = new URL(r.url); let op; if (r.postData && /graphql/.test(u.pathname)) { try { op = JSON.parse(r.postData).operationName; } catch (e) {} }
      return { atMs: Math.round(r.start - from), method: r.method, path: u.pathname + u.search.slice(0, 120), op, status: r.status, durationMs: r.end ? Math.round(r.end - r.start) : null, bytes: r.bytes };
    }),
    frames: arec.frames().filter((f) => f.at >= from && f.at <= to && f.preview !== 'ping' && f.preview !== 'pong').map((f) => ({ atMs: Math.round(f.at - from), ws: new URL(f.ws).pathname, dir: f.dir, bytes: f.bytes, preview: f.preview.slice(0, 400) })),
  });

  // 1. send -> appear latency
  for (let i = 0; i < N; i++) {
    const marker = `fresh-${Date.now()}-${i}`; await want(marker);
    const t0 = Date.now();
    const r = await j(await bctx.request.post(api, { data: { content: `Latency probe ${marker}`, nonce: `p${t0}` } }));
    const tResp = Date.now();
    const dom = await L.waitFor(() => textAt(marker), { timeout: 15_000, interval: 10 });
    await L.sleep(300);
    const frame = arec.frames().find((f) => f.dir === 'recv' && f.at >= t0 - 5 && f.preview.includes(r.body.id));
    const act = activity(t0, Date.now());
    out.sends.push({ i, id: r.body.id, status: r.status, postMs: tResp - t0, wsFrameMs: frame ? Math.round(frame.at - t0) : null, frameType: frame ? (frame.preview.match(/"type":"(\w+)"/) || [])[1] : null,
      domMs: dom ? dom - t0 : null, receiverRequests: act.requests, receiverFrames: act.frames.length });
    L.log('send', i, 'post', tResp - t0, 'ws', frame ? Math.round(frame.at - t0) : null, 'dom', dom ? dom - t0 : null, 'receiver reqs', act.requests.map((x) => x.op || x.path.slice(0, 60)).join(', '));
    await L.sleep(700);
  }
  const lastId = out.sends[out.sends.length - 1].id; const prevId = out.sends[out.sends.length - 2].id;

  // 2. edit / delete / reaction / reply as bob, observe alice for 4 s each
  const observe = async (name, fn, check) => {
    const t0 = Date.now(); const r = await fn(); const tResp = Date.now();
    const domAt = check ? await L.waitFor(check, { timeout: 8000, interval: 10 }) : null;
    await L.sleep(4000);
    out.events[name] = { status: r.status, postMs: tResp - t0, domMs: domAt ? domAt - t0 : null, ...activity(t0, Date.now()) };
    L.log(name, 'status', r.status, 'dom', out.events[name].domMs, 'reqs', out.events[name].requests.map((x) => x.op || x.path.slice(0, 70)).join(' | '), 'frames', out.events[name].frames.map((f) => (f.preview.match(/"type":"(\w+)"/) || [])[1] + (f.preview.match(/\\"type\\":\\"(\w+)\\"/g) || []).join('')).join(' | '));
  };
  const domTextTime = (text) => () => apage.evaluate((t) => { for (const n of document.querySelectorAll('[data-message-id]')) if ((n.textContent || '').includes(t)) return Date.now(); return null; }, text);
  await observe('edit', async () => j(await bctx.request.patch(`${api}/items/${lastId}`, { data: { content: 'Edited-marker-xyz', mentions: [], attachments: { type: 'preserve' }, nonce: `e${Date.now()}` } })), domTextTime('Edited-marker-xyz'));
  await observe('reaction', async () => j(await bctx.request.post(`${api}/items/${lastId}/reactions`, { data: { emoji: '🎉', add: true, nonce: `r${Date.now()}` } })),
    () => apage.evaluate((id) => { const n = document.querySelector(`[data-message-id="${id}"] [data-message-reaction-chip]`); return n ? Date.now() : null; }, lastId));
  await observe('thread_reply', async () => j(await bctx.request.post(api, { data: { content: 'Reply-marker-xyz', thread_id: prevId, nonce: `t${Date.now()}` } })), domTextTime('Reply-marker-xyz'));
  await observe('delete', async () => j(await bctx.request.delete(`${api}/items/${lastId}?nonce=d${Date.now()}`)),
    () => apage.evaluate((id) => (document.querySelector(`[data-message-id="${id}"]`) ? null : Date.now()), lastId));

  // 3. receiver offline for 30 s (CDP offline: HTTP fails, navigator.onLine=false), bob posts 3 + edits 1 meanwhile.
  const socketsBefore = arec.sockets().map((s) => ({ url: new URL(s.url).pathname, closed: !!s.closed }));
  const tOff = Date.now(); await arec.offline(true);
  const missed = [];
  for (let k = 0; k < 3; k++) { await L.sleep(5000); const m = `offline-${Date.now()}-${k}`; await want(m); const r = await j(await bctx.request.post(api, { data: { content: `While offline ${m}`, nonce: `o${Date.now()}` } })); missed.push({ marker: m, id: r.body.id, sentAtMs: Date.now() - tOff }); }
  await j(await bctx.request.patch(`${api}/items/${prevId}`, { data: { content: 'Edited-while-offline-xyz', mentions: [], attachments: { type: 'preserve' }, nonce: `eo${Date.now()}` } }));
  await L.sleep(Math.max(0, 30_000 - (Date.now() - tOff)));
  const duringOffline = activity(tOff, Date.now());
  const sawWhileOffline = []; for (const m of missed) sawWhileOffline.push(!!(await textAt(m.marker)));
  const socketsDuring = arec.sockets().map((s) => ({ url: new URL(s.url).pathname, closedAfterMs: s.closed ? Math.round(s.closed - tOff) : null, createdAfterMs: Math.round((s.open || s.created) - tOff) }));
  const tOn = Date.now(); await arec.offline(false);
  const caught = [];
  for (const m of missed) { const at = await L.waitFor(() => textAt(m.marker), { timeout: 60_000, interval: 20 }); caught.push({ marker: m.marker, appearedAfterOnlineMs: at ? at - tOn : null }); }
  const editAt = await L.waitFor(domTextTime('Edited-while-offline-xyz'), { timeout: 30_000, interval: 20 });
  await L.sleep(6000);
  out.offline = { offlineMs: tOn - tOff, socketsBefore, socketsDuring, sawWhileOffline, duringOffline, caughtUp: caught, offlineEditAppearedAfterOnlineMs: editAt ? editAt - tOn : null, afterOnline: activity(tOn, Date.now()),
    socketsAfter: arec.sockets().map((s) => ({ url: new URL(s.url).pathname, openedAfterOnlineMs: Math.round((s.open || s.created) - tOn), closed: !!s.closed })) };
  L.log('offline: saw while offline', sawWhileOffline, 'caught up', JSON.stringify(caught), 'edit', out.offline.offlineEditAppearedAfterOnlineMs);
  L.log('after online reqs:', out.offline.afterOnline.requests.map((x) => `${x.atMs}:${x.op || x.path.slice(0, 80)}`).join(' | '));
  L.log('sockets during', JSON.stringify(socketsDuring));
  const d = (k) => L.stats(out.sends.map((s) => s[k]));
  out.summary = { postMs: d('postMs'), wsFrameMs: d('wsFrameMs'), domMs: d('domMs') };
  L.log('summary', JSON.stringify(out.summary));
  fs.writeFileSync(path.join(L.OUT, 'freshness.json'), JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(L.OUT, 'freshness.partial.json'), JSON.stringify(out, null, 1)); process.exit(1); });
