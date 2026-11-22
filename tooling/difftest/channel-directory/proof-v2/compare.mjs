// Normalized comparison of what the trees return. Two levels:
//   data      every field of every channel row, against the primary's REST
//             list and /activity (truth) and between trees;
//   contract  what the readers derive (per-id keys, lists, open sections,
//             contact facts, the DM lookup), compared strictly between trees.
// Normalization: timestamps become epoch milliseconds (REST has microseconds,
// GraphQL milliseconds), participants are compared as a set sorted by user id
// (their order is reported separately), a missing field equals null, and
// frecency is ignored (neither list carries a score the readers use).

const isTimeKey = (key) => /(_at|At|Ms)$/.test(key) || key === 'lastViewedAt' || key === 'date';
function time(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Math.floor(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : parsed;
}

function normalizeMessage(message) {
  if (!message) return null;
  return {
    message_id: message.message_id ?? null,
    thread_id: message.thread_id ?? null,
    sender_id: message.sender_id ?? null,
    content: message.content ?? null,
    created_at: time(message.created_at),
    updated_at: time(message.updated_at),
    deleted_at: time(message.deleted_at),
    mentions: [...(message.mentions ?? [])].map((m) => JSON.stringify(m)).sort(),
  };
}

export function normalizeRow(row) {
  const participants = [...(row.participants ?? [])]
    .map((p) => ({ user_id: p.user_id, role: p.role, joined_at: time(p.joined_at), left_at: time(p.left_at) }))
    .sort((a, b) => (a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0));
  const out = {
    id: row.id,
    name: row.name ?? null,
    channel_type: row.channel_type,
    org_id: row.org_id ?? null,
    team_id: row.team_id ?? null,
    auto_join_team: row.auto_join_team ?? false,
    created_at: time(row.created_at),
    updated_at: time(row.updated_at),
    owner_id: row.owner_id ?? null,
    participants,
    is_participant: row.is_participant ?? null,
    latest_message: normalizeMessage(row.latest_message),
    latest_non_thread_message: normalizeMessage(row.latest_non_thread_message),
    viewed_at: time(row.viewed_at),
    interacted_at: time(row.interacted_at),
  };
  // Fields a tree adds beyond REST's shape (bots, agent DM) are compared too.
  for (const key of Object.keys(row)) {
    if (key in out || key === 'frecency_score') continue;
    out[key] = normalizeValue(row[key], key);
  }
  return out;
}

export function participantOrder(row) {
  return (row.participants ?? []).map((p) => p.user_id).join(',');
}

/** Deep-normalizes reader output: timestamps to ms, NaN to a tag. */
export function normalizeValue(value, key = '') {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  if (Array.isArray(value)) return value.map((item) => normalizeValue(item, key));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = normalizeValue(value[k], k);
    return out;
  }
  if (isTimeKey(key)) return time(value);
  return value;
}

/** Every differing leaf as {path, a, b}; array indices kept. */
export function diff(a, b, path = '', out = [], limit = 200) {
  if (out.length >= limit) return out;
  if (a === b) return out;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb || (ta !== 'object' && ta !== 'array')) {
    out.push({ path, a, b });
    return out;
  }
  if (ta === 'array') {
    if (a.length !== b.length) out.push({ path: `${path}.length`, a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out, limit);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of [...keys].sort()) diff(a[key] ?? null, b[key] ?? null, path ? `${path}.${key}` : key, out, limit);
  return out;
}

const generalize = (path) => path.replace(/\[\d+\]/g, '[]');

/** Truth rows carry viewed_at/interacted_at; main merges /activity the same
 * way, so truth is the REST row with its activity applied. */
export function truthRows(truth) {
  const activity = new Map((truth.activity ?? []).map((a) => [a.channel_id, a]));
  return truth.rows.map((row) => {
    const act = activity.get(row.id);
    return act ? { ...row, viewed_at: act.viewed_at ?? row.viewed_at, interacted_at: act.interacted_at ?? row.interacted_at } : row;
  });
}

/**
 * Compares one tree's rows against a reference: id sets, row order,
 * participant order, and every field. Returns a summary with counts per
 * generalized path and the first examples.
 */
export function compareRows(reference, rows, { ignore = [] } = {}) {
  const ref = new Map(reference.map((row) => [row.id, row]));
  const got = new Map(rows.map((row) => [row.id, row]));
  const missing = [...ref.keys()].filter((id) => !got.has(id));
  const extra = [...got.keys()].filter((id) => !ref.has(id));
  const fields = {};
  let participantOrderDiffs = 0;
  for (const [id, row] of got) {
    const base = ref.get(id);
    if (!base) continue;
    if (participantOrder(base) !== participantOrder(row)) participantOrderDiffs++;
    for (const d of diff(normalizeRow(base), normalizeRow(row))) {
      const key = generalize(d.path);
      if (ignore.some((pattern) => key.startsWith(pattern))) continue;
      fields[key] ??= { count: 0, examples: [] };
      fields[key].count++;
      if (fields[key].examples.length < 3) fields[key].examples.push({ id, a: d.a, b: d.b });
    }
  }
  const order = reference.map((row) => row.id).join() === rows.map((row) => row.id).join();
  return { reference: ref.size, rows: got.size, missing, extra, order, participantOrderDiffs, fields, equal: missing.length === 0 && extra.length === 0 && Object.keys(fields).length === 0 };
}

/** Strict contract comparison of two snapshots' derived outputs. */
export function compareContract(a, b, sections = ['perId', 'lists', 'open', 'facts', 'dm', 'dmOpen']) {
  const out = {};
  for (const section of sections) {
    const diffs = diff(normalizeValue(a[section]), normalizeValue(b[section]), section);
    if (diffs.length) out[section] = diffs;
  }
  return out;
}

/** Collapses contract diffs to generalized paths with counts and examples. */
export function summarizeContract(diffs, into = {}, context = {}) {
  for (const list of Object.values(diffs)) {
    for (const d of list) {
      const key = generalize(d.path).replace(/^perId\.[0-9a-f-]{36}\./, 'perId.<id>.');
      into[key] ??= { count: 0, examples: [] };
      into[key].count++;
      if (into[key].examples.length < 3) into[key].examples.push({ ...context, path: d.path, a: d.a, b: d.b });
    }
  }
  return into;
}
