// The write operations a sequence draws from, each a real REST call (or, for
// a role change, the SQL a role change would write: there is no REST route
// for it). `choose` picks the op's arguments from the group's state with the
// sequence's random source, or returns null when the op has no target now.
import { call, psql } from './rest.mjs';

export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const r = {
    next,
    chance: (p) => next() < p,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => items[Math.floor(next() * items.length)],
    sample: (items, count) => {
      const copy = [...items];
      const out = [];
      while (out.length < count && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
      return out;
    },
  };
  return r;
}
export function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}

export const ODD_NAMES = [
  `long-${'abcdefghij'.repeat(25)}`.slice(0, 255),
  `長い名前-${'日本語のチャンネル'.repeat(40)}`.slice(0, 255),
  'قناة-العمليات', 'ערוץ-צוות', '👩‍💻-builders', '🏳️‍🌈', '🚀', 'café', 'café', 'Alpha', 'alpha', 'ALPHA',
  ' leading space', 'trailing space ', '9', '10', '100', 'a10', 'a9', '#hash', 'it\'s "quoted"', 'back\\slash', 'Ωmega', 'zzz',
];
const WORDS = ['launch', 'ops', 'design', 'growth', 'infra', 'billing', 'q4', 'sales', 'eng', 'web', 'ai', 'data'];
function newName(r, state) {
  const roll = r.next();
  if (roll < 0.35) return r.pick(ODD_NAMES);
  if (roll < 0.5) {
    const named = [...state.channels.values()].filter((c) => c.name);
    if (named.length) return r.pick(named).name; // a duplicate name
  }
  return `${r.pick(WORDS)}-${r.pick(WORDS)}-${r.int(1, 999)}`;
}

const memberOf = (channel, user) => channel.members.has(user);
const channelsWhere = (state, test) => [...state.channels.values()].filter(test);
// A DM between two people (not an agent DM, whose bot is its other member).
const humans = (channel) => [...channel.members].filter((u) => !u.startsWith('bot|'));
const personDm = (channel) => channel.type === 'direct_message' && humans(channel).length >= 2;

/** The ops. Weights set how often each is drawn. */
export const OPS = {
  create: {
    weight: 10,
    choose(r, state, actor) {
      const kind = r.pick(['public', 'private', 'team']);
      const others = state.viewers.filter((v) => v !== actor);
      const participants = [...r.sample(others, r.int(0, 2)), ...r.sample(state.pool, r.int(0, 2))];
      return { kind, name: newName(r, state), participants, autoJoin: kind === 'team' && r.chance(0.4) };
    },
    async run(s, a, state) {
      const res = await call(s, '/dss/channels', {
        method: 'POST',
        body: { name: a.name, channel_type: a.kind, team_id: a.kind === 'team' ? state.team : null, auto_join_team: a.autoJoin, participants: a.participants },
      });
      return { ...res, created: res.body?.id ?? res.body?.channel_id ?? null };
    },
  },
  rename: {
    weight: 8,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id, name: newName(r, state) } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}`, { method: 'PATCH', body: { channel_name: a.name } }),
  },
  delete: {
    weight: 4,
    choose(r, state, actor) {
      const created = channelsWhere(state, (c) => c.created && memberOf(c, actor));
      const any = channelsWhere(state, (c) => memberOf(c, actor) && c.type !== 'direct_message');
      const pool = created.length && r.chance(0.85) ? created : any;
      return pool.length ? { id: r.pick(pool).id } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}`, { method: 'DELETE' }),
  },
  add: {
    weight: 8,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && memberOf(c, actor));
      if (!targets.length) return null;
      const channel = r.pick(targets);
      const outside = [...state.viewers, ...state.pool].filter((u) => !memberOf(channel, u));
      const viewersOut = state.viewers.filter((u) => !memberOf(channel, u));
      const chosen = viewersOut.length && r.chance(0.7) ? [r.pick(viewersOut)] : r.sample(outside, r.int(1, 2));
      return chosen.length ? { id: channel.id, participants: chosen } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/participants`, { method: 'POST', body: { participants: a.participants } }),
  },
  remove: {
    weight: 6,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && memberOf(c, actor) && c.members.size > 1);
      if (!targets.length) return null;
      const channel = r.pick(targets);
      const others = [...channel.members].filter((u) => u !== actor && !u.startsWith('bot|'));
      const viewersIn = others.filter((u) => state.viewers.includes(u));
      const chosen = viewersIn.length && r.chance(0.7) ? [r.pick(viewersIn)] : r.sample(others, 1);
      return chosen.length ? { id: channel.id, participants: chosen } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/participants`, { method: 'DELETE', body: { participants: a.participants } }),
  },
  leave: {
    weight: 6,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/leave`, { method: 'POST' }),
  },
  join: {
    weight: 6,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => (c.type === 'public' || c.type === 'team') && !memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/join`, { method: 'POST' }),
  },
  dm: {
    weight: 4,
    choose(r, state, actor) {
      const others = state.viewers.filter((v) => v !== actor);
      return { recipient: r.chance(0.7) ? r.pick(others) : r.pick(state.pool) };
    },
    async run(s, a) {
      const res = await call(s, '/dss/channels/get_or_create_dm', { method: 'POST', body: { recipient_id: a.recipient } });
      return { ...res, created: res.body?.channel_id ?? res.body?.id ?? null };
    },
  },
  groupDm: {
    weight: 4,
    choose(r, state, actor) {
      const others = state.viewers.filter((v) => v !== actor);
      return { recipients: [...r.sample(others, r.int(1, 2)), ...r.sample(state.pool, r.int(0, 2))] };
    },
    async run(s, a) {
      const res = await call(s, '/dss/channels/get_or_create_private', { method: 'POST', body: { recipients: a.recipients } });
      return { ...res, created: res.body?.channel_id ?? res.body?.id ?? null };
    },
  },
  botAdd: {
    weight: 4,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && memberOf(c, actor) && !memberOf(c, `bot|${state.bot}`));
      return targets.length ? { id: r.pick(targets).id, bot: state.bot } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/bots`, { method: 'POST', body: { bot_id: a.bot } }),
  },
  botRemove: {
    weight: 3,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => (c.type !== 'direct_message' || personDm(c)) && memberOf(c, actor) && memberOf(c, `bot|${state.bot}`));
      return targets.length ? { id: r.pick(targets).id, bot: state.bot } : null;
    },
    run: (s, a) => call(s, `/dss/bots/${a.bot}/channels/${a.id}`, { method: 'DELETE' }),
  },
  botDm: {
    // A bot in a DM between two people: rare, but no route refuses it, and
    // the DM then has a bot as well as the person it is with.
    weight: 2,
    choose(r, state, actor) {
      if (actor !== state.viewers[0]) return null;
      const targets = channelsWhere(state, (c) => personDm(c) && memberOf(c, actor) && !memberOf(c, `bot|${state.bot}`));
      return targets.length ? { id: r.pick(targets).id, bot: state.bot } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}/bots`, { method: 'POST', body: { bot_id: a.bot } }),
  },
  message: {
    weight: 8,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id, content: r.pick(['hi', 'shipping 🚀', 'ünïcödé', 'see thread', 'ok']) } : null;
    },
    run: (s, a) => call(s, `/dss/messages/channel/${a.id}`, { method: 'POST', body: { content: a.content, thread_id: null, nonce: crypto.randomUUID(), mentions: [] } }),
  },
  autoJoin: {
    weight: 4,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type === 'team' && memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id, on: r.chance(0.5) } : null;
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}`, { method: 'PATCH', body: { auto_join_team: a.on } }),
  },
  convert: {
    weight: 3,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => (c.type === 'team' || c.type === 'private' || c.type === 'public') && memberOf(c, actor));
      if (!targets.length) return null;
      const channel = r.pick(targets);
      return { id: channel.id, toTeam: channel.type !== 'team' };
    },
    run: (s, a) => call(s, `/dss/channels/${a.id}`, { method: 'PATCH', body: { convert_to_team_channel: a.toTeam } }),
  },
  view: {
    // Recorded by the app itself, on one of the actor's pages.
    weight: 6,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => memberOf(c, actor));
      return targets.length ? { id: r.pick(targets).id, page: r.pick(['M', 'C', 'N']) } : null;
    },
    inApp: true,
  },
  role: {
    // No REST route changes a role; this is the row a role change writes.
    weight: 3,
    choose(r, state, actor) {
      const targets = channelsWhere(state, (c) => c.type !== 'direct_message' && c.members.size > 1);
      if (!targets.length) return null;
      const channel = r.pick(targets);
      const user = r.pick([...channel.members].filter((u) => !u.startsWith('bot|')));
      return user ? { id: channel.id, user, role: r.pick(['owner', 'admin', 'member']) } : null;
    },
    async run(_s, a) {
      const started = performance.now();
      const out = await psql(`update comms_channel_participants set role = '${a.role}' where channel_id = '${a.id}' and user_id = '${a.user.replaceAll("'", "''")}' and left_at is null`);
      return { status: out.startsWith('UPDATE 1') ? 200 : 404, body: out, ms: performance.now() - started, sqlOnly: true };
    },
  },
};

export function drawOp(r) {
  const entries = Object.entries(OPS);
  const total = entries.reduce((sum, [, op]) => sum + op.weight, 0);
  let roll = r.next() * total;
  for (const [name, op] of entries) {
    roll -= op.weight;
    if (roll < 0) return name;
  }
  return entries[0][0];
}
