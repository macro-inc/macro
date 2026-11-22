// Minimal repro for live updates on cached (C) pages. Two viewers of one
// group each keep a C page open. Each round changes one channel both are in,
// over REST as another client would: a rename, adding a pool user, removing
// that user. Each page's directory row for the channel is read every 100 ms
// until it matches the primary, for at most 10 s, then once more at 10 s to
// catch a later revert; the websocket frames
// naming the channel are timed. Half the rounds reload the pages first.
// Prints ids and times only, never a session.
// Usage: node repro-live.mjs [group-number] [rounds] [tree]
import { launch, load, snapshot, viewerPage } from './pw.mjs';
import { loadGroup, readState } from './group-state.mjs';
import { call, psql } from './rest.mjs';

const number = Number(process.argv[2] ?? 9);
const rounds = Number(process.argv[3] ?? 6);
const tree = process.argv[4] ?? 'branch';
const group = loadGroup('q', number);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const state = await readState(group);
const [a, b] = group.viewers;
const shared = [...state.channels.values()].filter((c) => c.type !== 'direct_message' && c.members.has(a) && c.members.has(b));
if (!shared.length) throw new Error('no channel both viewers are in');
const channel = shared[0];
const pool = group.pool.find((p) => !channel.members.has(p));
const primary = async () => {
  const row = JSON.parse(await psql(`select json_build_object('name', c.name, 'members', (select coalesce(json_agg(p.user_id order by p.user_id), '[]') from comms_channel_participants p where p.channel_id = c.id and p.left_at is null and p.user_id not like 'bot|%')) from comms_channels c where c.id = '${channel.id}'`));
  return row;
};

const browser = await launch();
const pages = [];
for (const [index, viewer] of [a, b].entries()) {
  const page = await viewerPage(browser, group.sessions[group.viewers.indexOf(viewer)], { tree, mode: 'C' });
  page.frames = [];
  page.page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      const text = typeof frame.payload === 'string' ? frame.payload : '';
      if (text.includes(channel.id)) page.frames.push(Date.now());
    });
  });
  page.label = `v${index + 1}`;
  pages.push(page);
}
await Promise.all(pages.map((p) => load(p)));
const rowOn = async (p) => {
  const rows = (await snapshot(p, { rows: true, lists: false, open: false })).rows ?? [];
  const row = rows.find((r) => r.id === channel.id);
  return row ? { name: row.name, members: (row.participants ?? []).map((x) => x.user_id).sort() } : null;
};
const same = (x, y) => x && y && x.name === y.name && JSON.stringify(x.members) === JSON.stringify(y.members);

const ops = [
  ['rename', () => call(group.sessions[0], `/dss/channels/${channel.id}`, { method: 'PATCH', body: { channel_name: `live-${Date.now().toString(36)}` } })],
  ['add', () => call(group.sessions[0], `/dss/channels/${channel.id}/participants`, { method: 'POST', body: { participants: [pool] } })],
  ['remove', () => call(group.sessions[0], `/dss/channels/${channel.id}/participants`, { method: 'DELETE', body: { participants: [pool] } })],
];
for (let round = 0; round < rounds; round++) {
  const [op, run] = ops[round % ops.length];
  const reloaded = Math.floor(round / ops.length) % 2 === 0;
  if (reloaded) await Promise.all(pages.map((p) => load(p, { reload: true })));
  else await sleep(3000);
  for (const p of pages) p.frames = [];
  const wrote = Date.now();
  const res = await run();
  const truth = await primary();
  const result = { round, op, reloaded, status: res.status, pages: {} };
  await Promise.all(
    pages.map(async (p) => {
      let ms = null;
      let last = null;
      while (Date.now() - wrote < 10_000) {
        last = await rowOn(p);
        if (same(last, truth)) { ms = Date.now() - wrote; break; }
        await sleep(100);
      }
      // A page that converged can still be reverted by a later patch: read
      // the row again once the window is over.
      let held = null;
      if (ms !== null) {
        await sleep(Math.max(0, 10_000 - (Date.now() - wrote)));
        const final = await rowOn(p);
        held = same(final, truth);
        if (!held) last = final;
      }
      result.pages[p.label] = {
        convergedMs: ms,
        heldAt10s: held,
        ...(held === false ? { revertedTo: { members: last?.members.length ?? null, nameMatches: last?.name === truth.name } } : {}),
        frameMs: p.frames.map((t) => t - wrote),
        ...(ms === null ? { shownMembers: last?.members.length ?? null, primaryMembers: truth.members.length, nameMatches: last?.name === truth.name } : {}),
      };
    })
  );
  console.log(JSON.stringify(result));
}
await browser.close();
process.exit(0);
