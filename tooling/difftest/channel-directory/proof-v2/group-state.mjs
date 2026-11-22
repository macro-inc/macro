// A group's state as the generators see it: every channel the group knows
// about (its seeded channels, ones it created, and any channel a viewer is
// in), with its active members, read from the primary.
import fs from 'node:fs';
import path from 'node:path';
import { psql } from './rest.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);

export function loadGroup(kind, number, { manifest = path.join(here, 'seed-v2.manifest.json'), sessions = path.join(here, 'sessions-v2.json') } = {}) {
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const all = JSON.parse(fs.readFileSync(sessions, 'utf8'));
  const group = m.groups.find((g) => g.kind === kind && g.group === number);
  if (!group) throw new Error(`no group ${kind}${number}`);
  const byEmail = new Map(all.map((s) => [s.email, s]));
  return {
    label: `${kind}${String(number).padStart(2, '0')}`,
    viewers: group.viewers,
    sessions: group.emails.map((email) => byEmail.get(email)),
    team: group.team,
    bot: group.bot,
    pool: group.pool,
    known: new Set(Object.values(group.channels)),
    created: new Set(),
  };
}

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

export async function readState(group) {
  const viewers = group.viewers.map(quote).join(',');
  const known = [...group.known].map(quote).join(',') || 'NULL';
  const json = await psql(`
    select coalesce(json_agg(x), '[]') from (
      select c.id, c.channel_type as type, c.name, c.team_id, c.auto_join_team,
        coalesce(array_agg(p.user_id) filter (where p.left_at is null), '{}') as members
      from comms_channels c
      left join comms_channel_participants p on p.channel_id = c.id
      where c.id in (${known})
         or c.id in (select channel_id from comms_channel_participants where user_id in (${viewers}) and left_at is null)
         or (c.team_id = ${quote(group.team)})
      group by c.id
    ) x`);
  const channels = new Map();
  for (const row of JSON.parse(json)) {
    group.known.add(row.id);
    channels.set(row.id, { ...row, members: new Set(row.members), created: group.created.has(row.id) });
  }
  return { viewers: group.viewers, pool: group.pool, team: group.team, bot: group.bot, channels };
}
