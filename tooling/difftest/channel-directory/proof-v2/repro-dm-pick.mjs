// Minimal repro for which DM opening a person opens after a bot was added to
// the DM and removed again. v1 of a group gets a DM with a pool user it shares
// no DM with (get_or_create_dm), adds the group's bot to it, removes the bot,
// then opens the same person on main (M) and on the branch (C), through the
// app's openDirectMessage. Each page's pick is printed next to the DM's rows
// on the primary and, last, the DM the running server's get_or_create_dm
// returns for the pair (called for real once the pages have picked: it
// reuses this DM, or creates a second one).
// Prints ids, statuses and row counts only, never a session or an address.
// Usage: node repro-dm-pick.mjs [group-number]
import { launch, load, snapshot, viewerPage } from './pw.mjs';
import { loadGroup } from './group-state.mjs';
import { call, psql, channelRows, primaryLsn, waitReplica } from './rest.mjs';

const number = Number(process.argv[2] ?? 2);
const group = loadGroup('q', number);
const [viewer] = group.viewers;
const session = group.sessions[0];
const text = (value) => `'${String(value).replaceAll("'", "''")}'`;

let peer = null;
for (const candidate of group.pool) {
  const shared = await psql(`
    select 1 from comms_channel_participants a
    join comms_channel_participants b on b.channel_id = a.channel_id
    join comms_channels c on c.id = a.channel_id
    where c.channel_type = 'direct_message' and a.user_id = ${text(viewer)} and b.user_id = ${text(candidate)}
    limit 1`);
  if (!shared) {
    peer = candidate;
    break;
  }
}
if (!peer) throw new Error(`every pool user of ${group.label} already shares a DM with v1`);

const created = await call(session, '/dss/channels/get_or_create_dm', { method: 'POST', body: { recipient_id: peer } });
const id = created.body?.channel_id ?? created.body?.id;
if (created.status >= 300 || !id) throw new Error(`get_or_create_dm ${created.status}`);
const added = await call(session, `/dss/channels/${id}/bots`, { method: 'POST', body: { bot_id: group.bot } });
const removed = await call(session, `/dss/bots/${group.bot}/channels/${id}`, { method: 'DELETE' });
await waitReplica(await primaryLsn());

const rows = await channelRows(id);
const name = (value) => (value === id ? 'this DM' : value === null || value === undefined ? value : value === 'pending' ? 'pending (first message creates a DM)' : `another DM ${value}`);
const out = {
  group: group.label,
  dm: id,
  steps: { getOrCreateDm: created.status, botAdd: added.status, botRemove: removed.status },
  primary: { rows: rows.rows, activePeople: rows.activePeople.length, activeBots: rows.activeBots, leftBots: rows.leftBots, leftPeople: rows.leftPeople },
  opens: {},
};

const browser = await launch();
for (const [label, tree, mode] of [['main', 'main', 'M'], ['branch', 'branch', 'C']]) {
  const page = await viewerPage(browser, session, { tree, mode });
  await load(page);
  const snap = await snapshot(page, { ids: [], peers: [peer], lists: false, rows: false });
  const opened = snap.dmOpen?.[peer];
  out.opens[label] = { lookup: name(snap.dm?.[peer]), existing: opened?.existing ?? null, opens: name(opened?.id) };
  await page.context.close();
}
await browser.close();
const again = await call(session, '/dss/channels/get_or_create_dm', { method: 'POST', body: { recipient_id: peer } });
const againId = again.body?.channel_id ?? again.body?.id;
out.getOrCreateAfter = { status: again.status, returns: againId === id ? 'this DM (reused)' : `a second DM ${againId}` };
const serverPick = name(againId === id ? id : 'pending');
out.agree = {
  mainWithBranch: out.opens.main.opens === out.opens.branch.opens,
  branchWithGetOrCreate: out.opens.branch.opens === serverPick,
  mainWithGetOrCreate: out.opens.main.opens === serverPick,
};
console.log(JSON.stringify(out, null, 1));
process.exit(0);
