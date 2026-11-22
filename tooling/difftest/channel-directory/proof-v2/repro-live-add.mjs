// Repro detail for the add case of repro-live.mjs: the viewer whose session
// adds a pool user over REST keeps the old roster on its cached page. Records,
// on each of the two cached pages, every websocket frame naming the channel
// (its kind and operation, no payload) and every request the page sends after
// the write (path and GraphQL operation name), then the roster it shows.
// Usage: node repro-live-add.mjs [group-number] [tree]
import { launch, load, snapshot, viewerPage } from './pw.mjs';
import { loadGroup, readState } from './group-state.mjs';
import { call, psql } from './rest.mjs';

const number = Number(process.argv[2] ?? 9);
const tree = process.argv[3] ?? 'branch';
const group = loadGroup('q', number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = await readState(group);
const [a, b] = group.viewers;
const channel = [...state.channels.values()].find((c) => c.type !== 'direct_message' && c.members.has(a) && c.members.has(b));
const pool = group.pool.find((p) => !channel.members.has(p));
const members = async () => Number(await psql(`select count(*) from comms_channel_participants where channel_id = '${channel.id}' and left_at is null and user_id not like 'bot|%'`));

const browser = await launch();
const pages = [];
let wrote = Infinity;
for (const [index, viewer] of [a, b].entries()) {
  const p = { label: `v${index + 1}`, events: [] };
  const opName = (body) => {
    try { return JSON.parse(body ?? '{}').operationName ?? null; } catch { return null; }
  };
  Object.assign(p, await viewerPage(browser, group.sessions[group.viewers.indexOf(viewer)], {
    tree,
    mode: 'C',
    onRequest: (r) => {
      if (r.startedAt >= wrote) p.events.push({ at: r.startedAt - wrote, end: r.endedAt - wrote, req: `${r.method} ${r.path}`, op: opName(r.body), vars: r.body && opName(r.body) === "SoupBackfill" ? JSON.stringify(JSON.parse(r.body).variables).slice(0, 400) : undefined, status: r.status, ...(r.body?.includes(channel.id) ? { namesChannel: true } : {}) });
    },
  }));
  p.page.on('websocket', (ws) => {
    const path = new URL(ws.url()).pathname;
    ws.on('framereceived', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : '';
      if (!text.includes(channel.id) || Date.now() < wrote) return;
      let kind = null;
      try {
        const msg = JSON.parse(text);
        kind = msg.type ?? msg.event ?? null;
        const data = msg.payload?.data;
        if (data) kind = `${kind}[${Object.keys(data).join(",")}]`;
        const first = data && Object.values(data)[0];
        if (first && !Array.isArray(first)) kind = `${kind}{${Object.keys(first).slice(0, 12).join(",")}}`;
        const patches = msg.payload?.data?.soupUpdates;
        if (patches) kind = `${kind}:${patches.map((x) => `${x.__typename}${x.item ? `(${(x.item.participants ?? []).length} people)` : ''}`).join(',')}`;
      } catch {}
      p.events.push({ at: Date.now() - wrote, ws: path, kind, bytes: text.length, ...(kind?.includes("workFeedUpdates") ? { text: text.replace(/[a-z0-9.-]+@[a-z0-9.-]+/g, "<e>") } : {}) });
    });
  });
  pages.push(p);
}
await Promise.all(pages.map((p) => load(p)));
await sleep(3000);
const rosterOn = async (p) => {
  const rows = (await snapshot(p, { rows: true, lists: false, open: false })).rows ?? [];
  return (rows.find((r) => r.id === channel.id)?.participants ?? []).length;
};
const before = await members();
wrote = Date.now();
const res = await call(group.sessions[0], `/dss/channels/${channel.id}/participants`, { method: 'POST', body: { participants: [pool] } });
await sleep(8000);
const after = await members();
const out = { channel: channel.id, status: res.status, primaryBefore: before, primaryAfter: after, pages: {} };
for (const p of pages) out.pages[p.label] = { shown: await rosterOn(p), events: p.events.sort((x, y) => x.at - y.at) };
console.log(JSON.stringify(out, null, 1));
await call(group.sessions[0], `/dss/channels/${channel.id}/participants`, { method: 'DELETE', body: { participants: [pool] } });
await browser.close();
process.exit(0);
