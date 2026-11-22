// Generates channel data for the people sign-in.ts created, as SQL for the
// local stack's database. Deterministic: the same seed gives the same rows.
// Usage: bun seed.ts <seed> <sessions.json> <out.sql>
import type { Session } from './lib';

const SEED = Number(process.argv[2] ?? 20261120);
const sessions = (await Bun.file(process.argv[3] ?? 'sessions.json').json()) as Session[];
const out = process.argv[4] ?? 'seed.sql';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const chance = (p: number) => random() < p;
const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
function sample<T>(items: readonly T[], count: number): T[] {
  const copy = [...items];
  const chosen: T[] = [];
  while (chosen.length < count && copy.length > 0)
    chosen.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
  return chosen;
}

const START = Date.parse('2024-01-01T00:00:00Z');
const END = Date.parse('2026-11-19T00:00:00Z');
const instant = (from = START, to = END) => from + Math.floor(random() * (to - from));

// A v7-shaped id whose time prefix is the row's creation time.
function uuid(at: number) {
  const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
  const time = hex(at, 12);
  const rand = () => hex(Math.floor(random() * 0x10000), 4);
  const variant = hex(0x8000 | Math.floor(random() * 0x4000), 4);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${rand().slice(1)}-${variant}-${rand()}${rand()}${rand()}`;
}

const iso = (at: number) => new Date(at).toISOString();
const sql = (value: string | number | boolean | null) =>
  value === null
    ? 'NULL'
    : typeof value === 'string'
      ? `'${value.replaceAll("'", "''")}'`
      : String(value);

const rows: Record<string, { columns: string; values: string[] }> = {};
function insert(table: string, columns: string[], values: Array<string | number | boolean | null>) {
  rows[table] ??= { columns: columns.join(', '), values: [] };
  rows[table].values.push(`(${values.map(sql).join(', ')})`);
}

const FIRST = ['Ada', 'Béla', 'Chidi', 'Dana', 'Émile', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jun', 'Kai', 'Léa', 'Mo', 'Nia', "O'Neil", 'Priya', 'Quinn', 'Rui', 'Sana', 'Tomás', 'Uma', 'Vik', 'Wen', 'Xé', 'Yara', 'Zoë'];
const LAST = ['Okafor', 'Nguyen', 'Müller', 'Smith', 'García', 'Kowalski', 'Tanaka', 'Haddad', 'Silva', 'Ivanova', 'Lee', 'Brown', 'Jensen', 'Rossi', 'Dubois'];
const WORDS = ['launch', 'ops', 'design', 'growth', 'infra', 'billing', 'support', 'q4', 'sales', 'hiring', 'eng', 'mobile', 'web', 'search', 'ai', 'data', 'security', 'random', 'social', 'release', 'incidents', 'café', 'αβγ', '日本', '🚀', 'standup'];
const TEXT = ['sounds good', 'can you take a look?', 'shipping this today', 'see the doc', 'thanks!', 'who owns this?', 'merged 🎉', 'on it', 'line one\nline two', 'it\'s "fine"', 'ok', 'let\'s sync tomorrow at 10', 'ünïcödé text', 'deploy is green'];

// People: the signed-in ones, plus synthetic people who only appear as members.
const signedIn = sessions.map((session) => session.userId);
const heavy = signedIn[0];
const others = signedIn.slice(1);
const synthetic: string[] = [];
for (let index = 1; index <= 2600; index++) {
  const email = `gqlchan-p${String(index).padStart(4, '0')}@example.com`;
  const id = `macro|${email}`;
  const macroUserId = uuid(instant());
  insert('macro_user', ['id', 'username', 'email', 'stripe_customer_id'], [macroUserId, email, email, `cus_gqlchan_p${index}`]);
  const named = chance(0.85);
  insert('"User"', ['id', 'email', 'macro_user_id', '"firstName"', '"lastName"'], [id, email, macroUserId, named ? pick(FIRST) : null, named && chance(0.9) ? pick(LAST) : null]);
  synthetic.push(id);
}
const nameUpdates = others
  .filter(() => chance(0.8))
  .map((id) => `UPDATE "User" SET "firstName" = ${sql(pick(FIRST))}, "lastName" = ${sql(pick(LAST))} WHERE id = ${sql(id)};`);

// One team, owned by the heavy account.
const teamId = uuid(START);
insert('team', ['id', 'name', 'owner_id'], [teamId, 'Gqlchan team', heavy]);
const teamMembers = [heavy, ...others.slice(0, 20), ...synthetic.slice(0, 300)];
for (const member of teamMembers)
  insert('team_user', ['user_id', 'team_id', 'team_role'], [member, teamId, member === heavy ? 'owner' : chance(0.05) ? 'admin' : 'member']);

const bots = Array.from({ length: 4 }, (_, index) => ({ id: uuid(instant()), name: `Agent ${index + 1}` }));
for (const [index, bot] of bots.entries())
  insert('bots', ['id', 'kind', 'owner_user_id', 'name', 'handle', 'description', 'has_agent'], [bot.id, 'owned', heavy, bot.name, `gqlchan-agent-${index + 1}`, null, true]);

type Kind = 'direct_message' | 'private' | 'public' | 'team';
type Member = { userId: string; role: 'owner' | 'admin' | 'member'; joinedAt: number; leftAt: number | null };
const counts: Record<string, number> = {};
const memberships = new Map<string, number>();

function channel(spec: { kind: Kind; name: string | null; members: string[]; owner: string; leftUsers?: string[]; botMembers?: string[]; autoJoinTeam?: boolean; agentFor?: { bot: string; user: string }; label: string }) {
  counts[spec.label] = (counts[spec.label] ?? 0) + 1;
  const createdAt = instant();
  const updatedAt = chance(0.6) ? instant(createdAt) : createdAt;
  const id = uuid(createdAt);
  insert('comms_channels', ['id', 'name', 'channel_type', 'created_at', 'updated_at', 'owner_id', 'team_id', 'auto_join_team'], [id, spec.name, spec.kind, iso(createdAt), iso(updatedAt), spec.owner, spec.kind === 'team' ? teamId : null, spec.autoJoinTeam ?? false]);
  const members: Member[] = [];
  const add = (userId: string, left: boolean) => {
    const joinedAt = instant(createdAt);
    const role = userId === spec.owner ? 'owner' : spec.kind !== 'direct_message' && chance(0.08) ? 'admin' : 'member';
    members.push({ userId, role, joinedAt, leftAt: left ? instant(joinedAt) : null });
  };
  for (const userId of new Set(spec.members)) add(userId, (spec.leftUsers ?? []).includes(userId));
  for (const bot of spec.botMembers ?? []) add(`bot|${bot}`, false);
  for (const member of members) {
    insert('comms_channel_participants', ['channel_id', 'role', 'user_id', 'joined_at', 'left_at'], [id, member.role, member.userId, iso(member.joinedAt), member.leftAt === null ? null : iso(member.leftAt)]);
    if (member.leftAt === null && !member.userId.startsWith('bot|'))
      memberships.set(member.userId, (memberships.get(member.userId) ?? 0) + 1);
  }
  if (spec.agentFor)
    insert('comms_channel_agents', ['channel_id', 'bot_id', 'kind', 'user_id'], [id, spec.agentFor.bot, 'direct', spec.agentFor.user]);

  // The people who can see it read and write in it.
  const readers = members.filter((member) => !member.userId.startsWith('bot|'));
  for (const reader of readers) {
    if (!chance(reader.userId === heavy ? 0.75 : 0.4)) continue;
    const viewed = chance(0.85) ? instant(reader.joinedAt) : null;
    const interacted = chance(0.5) ? instant(reader.joinedAt) : null;
    const at = viewed ?? reader.joinedAt;
    insert('comms_activity', ['id', 'user_id', 'channel_id', 'created_at', 'updated_at', 'viewed_at', 'interacted_at'], [uuid(at), reader.userId, id, iso(reader.joinedAt).replace('Z', ''), iso(at).replace('Z', ''), viewed === null ? null : iso(viewed).replace('Z', ''), interacted === null ? null : iso(interacted).replace('Z', '')]);
  }
  if (!chance(0.65)) return;
  const senders = members.map((member) => member.userId);
  let at = createdAt;
  const roots: string[] = [];
  const messageCount = int(1, 4);
  for (let index = 0; index < messageCount; index++) {
    at = instant(at, Math.min(END, at + 30 * 24 * 3600 * 1000));
    const messageId = uuid(at);
    const isReply = roots.length > 0 && index === messageCount - 1 && chance(0.2);
    const deleted = !isReply && index === messageCount - 1 && chance(0.06);
    const edited = chance(0.1) ? instant(at, Math.min(END, at + 3600 * 1000)) : null;
    const sender = pick(senders);
    insert('comms_messages', ['id', 'thread_id', 'sender_id', 'content', 'created_at', 'updated_at', 'edited_at', 'deleted_at', 'parent_entity_type', 'parent_entity_id'], [messageId, isReply ? pick(roots) : null, sender, pick(TEXT), iso(at), iso(edited ?? at), edited === null ? null : iso(edited).replace('Z', ''), deleted ? iso(at + 1000).replace('Z', '') : null, 'channel', id]);
    if (!isReply) roots.push(messageId);
    if (chance(0.1))
      insert('comms_entity_mentions', ['entity_type', 'entity_id', 'source_entity_type', 'source_entity_id', 'user_id'], ['user', pick(senders), 'message', messageId, sender]);
  }
}

const channelName = () => {
  const base = `${pick(WORDS)}-${pick(WORDS)}`;
  if (chance(0.02)) return `${base}-${'x'.repeat(int(100, 230))}`;
  return chance(0.3) ? base : `${base}-${int(1, 999)}`;
};
const people = [...others, ...synthetic];
const extraMembers = (max: number, pool = people) => sample(pool, int(1, max));

// The heavy account: about 15,000 joined channels of every kind.
for (const person of [...others, ...synthetic.slice(0, 2500)])
  channel({ kind: 'direct_message', name: null, members: [heavy, person], owner: chance(0.5) ? heavy : person, label: 'heavy dm' });
for (const bot of bots)
  channel({ kind: 'direct_message', name: null, members: [heavy], botMembers: [bot.id], owner: heavy, agentFor: { bot: bot.id, user: heavy }, label: 'heavy agent dm' });
for (let index = 0; index < 900; index++) {
  const members = [heavy, ...extraMembers(6)];
  channel({ kind: 'private', name: null, members, owner: pick(members), leftUsers: members.filter((m) => m !== heavy && chance(0.1)), label: 'heavy group dm' });
}
for (let index = 0; index < 6550; index++) {
  const members = [heavy, ...extraMembers(12)];
  channel({ kind: 'private', name: channelName(), members, owner: pick(members), leftUsers: members.filter((m) => m !== heavy && chance(0.1)), botMembers: chance(0.03) ? [pick(bots).id] : [], label: 'heavy private' });
}
for (let index = 0; index < 3200; index++) {
  const members = [heavy, ...extraMembers(20)];
  channel({ kind: 'public', name: channelName(), members, owner: pick(members), leftUsers: members.filter((m) => m !== heavy && chance(0.1)), botMembers: chance(0.03) ? [pick(bots).id] : [], label: 'heavy public' });
}
for (let index = 0; index < 1800; index++) {
  const members = [heavy, ...extraMembers(15, teamMembers.slice(1))];
  channel({ kind: 'team', name: channelName(), members, owner: pick(members), autoJoinTeam: chance(0.1), leftUsers: members.filter((m) => m !== heavy && chance(0.1)), label: 'heavy team' });
}
// Channels the heavy account left or never joined: in neither list.
for (let index = 0; index < 600; index++) {
  const members = [heavy, ...extraMembers(8)];
  channel({ kind: chance(0.5) ? 'public' : 'private', name: channelName(), members, owner: pick(members.slice(1)), leftUsers: [heavy], label: 'heavy left' });
}
for (let index = 0; index < 700; index++) {
  const members = extraMembers(8);
  channel({ kind: 'public', name: channelName(), members, owner: members[0], label: 'public, heavy not a member' });
}
for (let index = 0; index < 200; index++) {
  const members = extraMembers(8, teamMembers.slice(1));
  channel({ kind: 'team', name: channelName(), members, owner: members[0], label: 'team, heavy not a member' });
}

// The other signed-in people's own channels, without the heavy account.
const smallPairs = new Set<string>();
for (const person of others) {
  for (let index = 0; index < 30; index++) {
    const kind = pick<Kind>(['direct_message', 'private', 'private', 'public']);
    if (kind === 'direct_message') {
      const other = pick(synthetic.slice(2500).filter((candidate) => !smallPairs.has(`${person} ${candidate}`)));
      smallPairs.add(`${person} ${other}`);
      channel({ kind, name: null, members: [person, other], owner: person, label: 'small dm' });
      continue;
    }
    const members = [person, ...extraMembers(6, [...others, ...synthetic.slice(2500)])];
    channel({ kind, name: kind === 'private' && chance(0.3) ? null : channelName(), members, owner: person, leftUsers: members.filter((m) => m !== person && chance(0.1)), label: `small ${kind}` });
  }
}

const ORDER = ['macro_user', '"User"', 'team', 'team_user', 'bots', 'comms_channels', 'comms_channel_participants', 'comms_channel_agents', 'comms_activity', 'comms_messages', 'comms_entity_mentions'];
const parts = ['BEGIN;', ...nameUpdates];
for (const table of ORDER) {
  const { columns, values } = rows[table];
  for (let start = 0; start < values.length; start += 1000)
    parts.push(`INSERT INTO ${table} (${columns}) VALUES\n${values.slice(start, start + 1000).join(',\n')};`);
}
parts.push('COMMIT;', 'ANALYZE;');
await Bun.write(out, parts.join('\n'));

const totals = Object.fromEntries(ORDER.map((table) => [table, rows[table].values.length]));
const signedInMemberships = signedIn.map((id) => memberships.get(id) ?? 0);
console.log(JSON.stringify({ seed: SEED, channels: counts, rows: totals, heavyJoined: memberships.get(heavy), othersJoined: { min: Math.min(...signedInMemberships.slice(1)), max: Math.max(...signedInMemberships.slice(1)) } }, null, 2));
