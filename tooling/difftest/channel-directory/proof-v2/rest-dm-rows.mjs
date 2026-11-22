// Prints, for one group's v1, the REST list's participants for every DM it
// holds, next to the primary's rows: which kinds of rows REST shows.
// Ids and kinds only, never a session.
import { loadGroup } from './group-state.mjs';
import { restTruth, channelRows } from './rest.mjs';
const group = loadGroup('q', Number(process.argv[2] ?? 1));
const { rows } = await restTruth(group.sessions[0]);
for (const c of rows.filter((r) => r.channel_type === 'direct_message')) {
  const primary = await channelRows(c.id);
  const rest = c.participants.map((p) => (p.user_id.startsWith('bot|') ? 'bot' : 'person'));
  console.log(JSON.stringify({ id: c.id, rest, primary: { rows: primary.rows, activePeople: primary.activePeople.length, activeBots: primary.activeBots, leftBots: primary.leftBots, leftPeople: primary.leftPeople } }));
}
process.exit(0);
