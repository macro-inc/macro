// Seeds the viewers of differential v2 on the gqlchan stack. Synthetic data
// only. Deterministic for a seed: the same seed gives the same rows (ids and
// names), given the same signed-in user ids.
//
//   bucket viewers  gqlv2-b-<N>: exactly N joined channels, N in SIZES, plus
//                   left channels, unjoined public and unjoined team channels,
//                   odd names, timestamp ties (some across page boundaries),
//                   null and missing activity, channels without messages.
//   group viewers   gqlv2-<q|l>-gNN-v<1..3>: one team, one agent bot owned by
//                   v1, and a starting set of channels the sequences mutate.
//
// Usage: bun seed-v2.ts <seed> <groups per kind> <sessions-out.json> <out.sql>
//   It signs every viewer in first (which creates them), then writes the SQL.
import { signIn, type Session } from '../lib';

const SEED = Number(process.argv[2] ?? 20261121);
const GROUPS = Number(process.argv[3] ?? 10);
const sessionsOut = process.argv[4] ?? 'sessions-v2.json';
const out = process.argv[5] ?? 'seed-v2.sql';
export const SIZES = [0, 1, 99, 100, 101, 200, 2000];

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

const START = Date.parse('2025-01-01T00:00:00Z');
const END = Date.parse('2026-11-20T00:00:00Z');
const instant = (from = START, to = END) => from + Math.floor(random() * (to - from));
function uuid(at: number) {
  const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');
  const time = hex(at, 12);
  const rand = () => hex(Math.floor(random() * 0x10000), 4);
  const variant = hex(0x8000 | Math.floor(random() * 0x4000), 4);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${rand().slice(1)}-${variant}-${rand()}${rand()}${rand()}`;
}
const iso = (at: number) => new Date(at).toISOString();
const naive = (at: number) => iso(at).replace('Z', '');
const sql = (value: string | number | boolean | null) =>
  value === null ? 'NULL' : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : String(value);

const rows: Record<string, { columns: string; values: string[] }> = {};
function insert(table: string, columns: string[], values: Array<string | number | boolean | null>) {
  rows[table] ??= { columns: columns.join(', '), values: [] };
  rows[table].values.push(`(${values.map(sql).join(', ')})`);
}

// Odd names: long (255 characters, ASCII and multibyte), right-to-left,
// joined emoji, combining marks next to their composed form, case and space
// variants, digits that sort differently as text and as numbers, quotes.
const LONG_ASCII = `long-${'abcdefghij'.repeat(25)}`.slice(0, 255);
const LONG_WIDE = `長い名前-${'日本語のチャンネル'.repeat(40)}`.slice(0, 255);
const ODD_NAMES = [
  LONG_ASCII, LONG_WIDE, 'قناة-العمليات', 'ערוץ-צוות', '👩‍💻-builders', '🏳️‍🌈', '🚀',
  'café', 'café', 'Alpha', 'alpha', 'ALPHA', ' leading space', 'trailing space ',
  '9', '10', '100', 'a10', 'a9', '#hash', 'it\'s "quoted"', 'back\\slash', 'ünïcödé', 'Ωmega', 'zzz',
];
const WORDS = ['launch', 'ops', 'design', 'growth', 'infra', 'billing', 'support', 'q4', 'sales', 'eng', 'web', 'ai', 'data', 'release', 'standup'];
const plainName = () => `${pick(WORDS)}-${pick(WORDS)}-${int(1, 999)}`;
const TEXT = ['sounds good', 'can you take a look?', 'shipping this today', 'thanks!', 'merged 🎉', 'on it', 'ok'];

// Synthetic members already in the stack's database (seed.ts).
const PEOPLE_ALL = Array.from({ length: 2600 }, (_, index) => `macro|gqlchan-p${String(index + 1).padStart(4, '0')}@example.com`);
// seed.ts put p0001..p0300 in its team; a person belongs to at most one team.
const PEOPLE = PEOPLE_ALL;
const BUCKET_TEAM = PEOPLE_ALL.slice(300, 340);

type Kind = 'direct_message' | 'private' | 'public' | 'team';
type Spec = {
  kind: Kind;
  name: string | null;
  owner: string;
  members: string[];
  left?: string[];
  bots?: string[];
  teamId?: string | null;
  autoJoinTeam?: boolean;
  agentFor?: { bot: string; user: string };
  at?: { created: number; updated: number };
  activity?: Record<string, 'none' | 'null' | number>;
  messages?: number;
  label: string;
};
const labels: Record<string, number> = {};
const joined = new Map<string, number>();
const manifest: Record<string, unknown> = {};

function channel(spec: Spec): string {
  labels[spec.label] = (labels[spec.label] ?? 0) + 1;
  const created = spec.at?.created ?? instant();
  const updated = spec.at?.updated ?? (chance(0.6) ? instant(created) : created);
  const id = uuid(created);
  insert('comms_channels', ['id', 'name', 'channel_type', 'created_at', 'updated_at', 'owner_id', 'team_id', 'auto_join_team'], [id, spec.name, spec.kind, iso(created), iso(updated), spec.owner, spec.kind === 'team' ? (spec.teamId ?? null) : null, spec.autoJoinTeam ?? false]);
  const people = [...new Set([spec.owner, ...spec.members])];
  for (const userId of people) {
    const joinedAt = spec.at ? created : instant(created, Math.min(END, created + 86_400_000));
    const left = spec.left?.includes(userId) ? naiveLeft(joinedAt) : null;
    const role = userId === spec.owner ? 'owner' : spec.kind !== 'direct_message' && chance(0.08) ? 'admin' : 'member';
    insert('comms_channel_participants', ['channel_id', 'role', 'user_id', 'joined_at', 'left_at'], [id, role, userId, iso(joinedAt), left]);
    if (!left) joined.set(userId, (joined.get(userId) ?? 0) + 1);
    const activity = spec.activity?.[userId];
    if (activity === undefined || activity === 'none') continue;
    const viewed = activity === 'null' ? null : activity;
    insert('comms_activity', ['id', 'user_id', 'channel_id', 'created_at', 'updated_at', 'viewed_at', 'interacted_at'], [uuid(joinedAt), userId, id, naive(joinedAt), naive(viewed ?? joinedAt), viewed === null ? null : naive(viewed), null]);
  }
  for (const bot of spec.bots ?? [])
    insert('comms_channel_participants', ['channel_id', 'role', 'user_id', 'joined_at', 'left_at'], [id, 'member', `bot|${bot}`, iso(created), null]);
  if (spec.agentFor)
    insert('comms_channel_agents', ['channel_id', 'bot_id', 'kind', 'user_id'], [id, spec.agentFor.bot, 'direct', spec.agentFor.user]);
  let at = created;
  for (let index = 0; index < (spec.messages ?? 0); index++) {
    at = instant(at, Math.min(END, at + 7 * 86_400_000));
    insert('comms_messages', ['id', 'thread_id', 'sender_id', 'content', 'created_at', 'updated_at', 'parent_entity_type', 'parent_entity_id'], [uuid(at), null, pick(people), pick(TEXT), iso(at), iso(at), 'channel', id]);
  }
  return id;
}
function naiveLeft(joinedAt: number) {
  return iso(instant(joinedAt, Math.min(END, joinedAt + 30 * 86_400_000)));
}
function activityFor(userId: string, created: number): Spec['activity'] {
  const roll = random();
  if (roll < 0.2) return { [userId]: 'none' };
  if (roll < 0.3) return { [userId]: 'null' };
  return { [userId]: instant(created) };
}

const bucketEmail = (size: number) => `gqlv2-b-${String(size).padStart(4, '0')}@example.com`;
const groupEmail = (kind: 'q' | 'l', group: number, viewer: number) => `gqlv2-${kind}-g${String(group).padStart(2, '0')}-v${viewer}@example.com`;

// Sign every viewer in; that creates them.
const emails = [
  ...SIZES.map(bucketEmail),
  ...(['q', 'l'] as const).flatMap((kind) => Array.from({ length: GROUPS }, (_, g) => [1, 2, 3].map((v) => groupEmail(kind, g + 1, v))).flat()),
];
const sessions: Session[] = [];
for (const [index, email] of emails.entries()) {
  sessions.push(await signIn(email));
  if (index % 10 === 9) console.error(`signed in ${index + 1}/${emails.length}`);
}
await Bun.write(sessionsOut, JSON.stringify(sessions, null, 2));
const idOf = new Map(sessions.map((session) => [session.email, session.userId]));
const id = (email: string) => {
  const found = idOf.get(email);
  if (!found) throw new Error(`no session for ${email}`);
  return found;
};

// ---------------------------------------------------------------- buckets
const bucketIds = SIZES.map((size) => id(bucketEmail(size)));
const bucketTeam = uuid(START);
insert('team', ['id', 'name', 'owner_id'], [bucketTeam, 'Gqlv2 bucket team', bucketIds.at(-1)!]);
for (const member of [...bucketIds, ...BUCKET_TEAM])
  insert('team_user', ['user_id', 'team_id', 'team_role'], [member, bucketTeam, member === bucketIds.at(-1) ? 'owner' : 'member']);

const bucketBots: Record<string, string> = {};
for (const [index, size] of SIZES.entries()) {
  if (size < 99) continue;
  const bot = uuid(instant());
  bucketBots[size] = bot;
  insert('bots', ['id', 'kind', 'owner_user_id', 'name', 'handle', 'description', 'has_agent', 'deleted_at'], [bot, 'owned', bucketIds[index], `Bucket agent ${size}`, `gqlv2-bucket-${size}`, null, true, null]);
}
// A deleted bot that is still a participant somewhere.
const deletedBot = uuid(instant());
insert('bots', ['id', 'kind', 'owner_user_id', 'name', 'handle', 'description', 'has_agent', 'deleted_at'], [deletedBot, 'owned', bucketIds.at(-1)!, 'Deleted agent', 'gqlv2-deleted', null, true, iso(END)]);

for (const [index, size] of SIZES.entries()) {
  const viewer = bucketIds[index];
  const pool = sample(PEOPLE, 400);
  const made: string[] = [];
  // Tie clusters: shared created/updated instants, placed so that one cluster
  // straddles the 100-row page boundary of every list that pages by 100.
  const tieAt = instant();
  const tieRange = size >= 101 ? [Math.max(0, 95), Math.min(size, 106)] : size >= 99 ? [size - 4, size] : [0, 0];
  const second = size >= 200 ? [180, 200] : [0, 0];
  const secondAt = instant();
  const regular = size >= 99 ? size - 1 : size;
  for (let n = 0; n < regular; n++) {
    const tied = n >= tieRange[0] && n < tieRange[1] ? tieAt : n >= second[0] && n < second[1] ? secondAt : null;
    const at = tied ? { created: tied, updated: tied } : undefined;
    const created = at?.created ?? instant();
    const odd = n < ODD_NAMES.length && size >= 99 ? ODD_NAMES[n] : null;
    const duplicate = size >= 99 && n >= ODD_NAMES.length && n < ODD_NAMES.length + 6 ? 'duplicate-name' : null;
    const roll = size === 1 ? 0 : random();
    const messages = chance(0.3) ? int(1, 3) : 0;
    const activity = tied && chance(0.5) ? { [viewer]: tied } : activityFor(viewer, created);
    if (roll < 0.25) {
      made.push(channel({ kind: 'direct_message', name: null, owner: chance(0.5) ? viewer : pool[n % pool.length], members: [viewer, pool[n % pool.length]], at, activity, messages, label: `bucket dm` }));
    } else if (roll < 0.35) {
      made.push(channel({ kind: 'private', name: null, owner: viewer, members: [viewer, ...sample(pool, int(2, 5))], at, activity, messages, label: `bucket group dm` }));
    } else if (roll < 0.6) {
      const members = [viewer, ...sample(pool, int(0, 8))];
      made.push(channel({ kind: 'private', name: odd ?? duplicate ?? plainName(), owner: pick(members), members, left: members.filter((m) => m !== viewer && chance(0.1)), bots: n === 7 && size >= 99 ? [bucketBots[size]] : n === 8 && size === 2000 ? [deletedBot] : [], at, activity, messages, label: `bucket private` }));
    } else if (roll < 0.8) {
      const members = [viewer, ...sample(pool, int(0, 12))];
      made.push(channel({ kind: 'public', name: odd ?? duplicate ?? plainName(), owner: pick(members), members, at, activity, messages, label: `bucket public` }));
    } else {
      const members = [viewer, ...sample(BUCKET_TEAM, int(0, 6))];
      made.push(channel({ kind: 'team', name: odd ?? duplicate ?? plainName(), owner: pick(members), members, teamId: bucketTeam, autoJoinTeam: chance(0.1), at, activity, messages, label: `bucket team` }));
    }
  }
  // The larger buckets hold one agent DM among their N channels.
  if (size >= 99)
    made.push(channel({ kind: 'direct_message', name: null, owner: viewer, members: [viewer], bots: [bucketBots[size]], agentFor: { bot: bucketBots[size], user: viewer }, activity: { [viewer]: instant() }, label: 'bucket agent dm' }));
  // Not counted: channels the viewer left, public and team channels it never joined.
  for (let n = 0; n < (size === 0 ? 2 : 3); n++) {
    const members = [viewer, ...sample(pool, int(1, 5))];
    channel({ kind: n === 0 ? 'public' : 'private', name: plainName(), owner: members[1], members, left: [viewer], label: 'bucket left' });
  }
  for (let n = 0; n < 5; n++) channel({ kind: 'public', name: plainName(), owner: pool[n], members: sample(pool, int(1, 4)), label: 'bucket unjoined public' });
  for (let n = 0; n < 3; n++) channel({ kind: 'team', name: plainName(), owner: BUCKET_TEAM[n], members: sample(BUCKET_TEAM, int(1, 3)), teamId: bucketTeam, label: 'bucket unjoined team' });
  manifest[`bucket-${size}`] = { email: bucketEmail(size), userId: viewer };
}
// ---------------------------------------------------------------- groups
const groups: unknown[] = [];
let groupIndex = 0;
for (const kind of ['q', 'l'] as const) {
  for (let g = 1; g <= GROUPS; g++) {
    const [v1, v2, v3] = [1, 2, 3].map((v) => id(groupEmail(kind, g, v)));
    // Disjoint per group: a person belongs to at most one team.
    const pool = PEOPLE.slice(400 + groupIndex * 24, 424 + groupIndex * 24);
    groupIndex += 1;
    const team = uuid(instant());
    insert('team', ['id', 'name', 'owner_id'], [team, `Gqlv2 ${kind}${g} team`, v1]);
    for (const member of [v1, v2, v3, ...pool.slice(0, 8)])
      insert('team_user', ['user_id', 'team_id', 'team_role'], [member, team, member === v1 ? 'owner' : 'member']);
    const bot = uuid(instant());
    insert('bots', ['id', 'kind', 'owner_user_id', 'name', 'handle', 'description', 'has_agent', 'deleted_at'], [bot, 'owned', v1, `Agent ${kind}${g}`, `gqlv2-${kind}${g}-agent`, null, true, null]);
    const act = (...users: string[]) => Object.fromEntries(users.map((user) => [user, chance(0.2) ? 'null' as const : instant()]));
    const channels = {
      dm12: channel({ kind: 'direct_message', name: null, owner: v1, members: [v1, v2], activity: act(v1, v2), messages: 2, label: 'group dm' }),
      dm23: channel({ kind: 'direct_message', name: null, owner: v2, members: [v2, v3], activity: act(v2), label: 'group dm' }),
      groupDm: channel({ kind: 'private', name: null, owner: v1, members: [v1, v2, v3, pool[0]], activity: act(v1, v2, v3), messages: 1, label: 'group group dm' }),
      private13: channel({ kind: 'private', name: pick(ODD_NAMES.slice(2)), owner: v1, members: [v1, v3, pool[1], pool[2]], activity: act(v1), label: 'group private' }),
      public21: channel({ kind: 'public', name: plainName(), owner: v2, members: [v2, v1, pool[3]], activity: act(v2, v1), label: 'group public' }),
      public3: channel({ kind: 'public', name: plainName(), owner: v3, members: [v3, pool[4]], label: 'group public' }),
      team12: channel({ kind: 'team', name: plainName(), owner: v1, members: [v1, v2, pool[5]], teamId: team, activity: act(v1), label: 'group team' }),
      teamAuto: channel({ kind: 'team', name: plainName(), owner: v1, members: [v1, v2, v3], teamId: team, autoJoinTeam: true, label: 'group team auto-join' }),
      botRoom: channel({ kind: 'private', name: plainName(), owner: v1, members: [v1, v2], bots: [bot], activity: act(v1, v2), label: 'group private with bot' }),
      agentDm: channel({ kind: 'direct_message', name: null, owner: v1, members: [v1], bots: [bot], agentFor: { bot, user: v1 }, activity: act(v1), label: 'group agent dm' }),
      left2: channel({ kind: 'private', name: plainName(), owner: v1, members: [v1, v2, v3], left: [v2], label: 'group left' }),
    };
    groups.push({ kind, group: g, viewers: [v1, v2, v3], emails: [1, 2, 3].map((v) => groupEmail(kind, g, v)), team, bot, pool, channels });
  }
}
manifest.groups = groups;
manifest.bucketTeam = bucketTeam;
manifest.seed = SEED;

const ORDER = ['team', 'team_user', 'bots', 'comms_channels', 'comms_channel_participants', 'comms_channel_agents', 'comms_activity', 'comms_messages'];
const parts = ['BEGIN;'];
for (const table of ORDER) {
  const block = rows[table];
  if (!block) continue;
  for (let start = 0; start < block.values.length; start += 1000)
    parts.push(`INSERT INTO ${table} (${block.columns}) VALUES\n${block.values.slice(start, start + 1000).join(',\n')};`);
}
parts.push('COMMIT;', 'ANALYZE;');
await Bun.write(out, parts.join('\n'));
await Bun.write(out.replace(/\.sql$/, '.manifest.json'), JSON.stringify(manifest, null, 2));
const expected = Object.fromEntries(SIZES.map((size, index) => [size, joined.get(bucketIds[index]) ?? 0]));
console.log(JSON.stringify({ seed: SEED, labels, rows: Object.fromEntries(ORDER.map((t) => [t, rows[t]?.values.length ?? 0])), bucketJoined: expected }, null, 2));
