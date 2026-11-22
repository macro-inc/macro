// Gives every group a DM between v1 and v3 with v1's bot added, through the
// same routes the app uses (get_or_create_dm, then the channel bots route).
// No route refuses a bot in a person's DM, so the directory has to read one.
import fs from 'node:fs';
import path from 'node:path';
import { call, psql } from './rest.mjs';
import { loadGroup } from './group-state.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'seed-v2.manifest.json'), 'utf8'));
const out = {};
for (const g of manifest.groups) {
  const group = loadGroup(g.kind, g.group);
  const [v1s] = group.sessions;
  const dm = await call(v1s, '/dss/channels/get_or_create_dm', { method: 'POST', body: { recipient_id: group.viewers[2] } });
  const id = dm.body?.channel_id ?? dm.body?.id;
  if (dm.status >= 300 || !id) throw new Error(`${group.label} dm ${dm.status}`);
  const bot = await call(v1s, `/dss/channels/${id}/bots`, { method: 'POST', body: { bot_id: group.bot } });
  if (bot.status >= 300) throw new Error(`${group.label} bot ${bot.status} ${JSON.stringify(bot.body).slice(0, 120)}`);
  const kinds = await psql(`select string_agg(case when user_id like 'bot|%' then 'bot' else 'person' end, ',' order by ctid) from comms_channel_participants where channel_id = '${id}' and left_at is null`);
  out[group.label] = { id, physicalOrder: kinds };
  console.log(group.label, 'dm13+bot', dm.status, bot.status, kinds);
}
fs.writeFileSync(path.join(here, 'augment-bot-dm.json'), JSON.stringify(out, null, 2));
