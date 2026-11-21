// Compares one snapshot of both readers, at the data level (every field the
// reader returns) and the contract level (what callers show or decide), and
// each side against the database.

export type Row = {
  channel_id?: string;
  user_id: string;
  role: string;
  joined_at: string;
  left_at?: string | null;
};

export type ReaderState = {
  isPending: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  data: Row[] | undefined;
};

export type Snap = {
  at: number;
  old: ReaderState;
  new: ReaderState;
  oldContract: Record<string, unknown>;
  newContract: Record<string, unknown>;
};

export type Bucket =
  /** Every field and every caller decision equal. */
  | 'same'
  /** Some returned field differs; no caller decision does. */
  | 'data-only'
  /** Callers differ, and only the new side matches the database. */
  | 'main-stale'
  /** Callers differ, and only main matches the database. A regression until closed. */
  | 'new-wrong'
  /** Callers differ only in the order of people who joined at the same instant: an order neither side specifies. */
  | 'tie-order'
  /** Callers differ, both match the database or neither does. */
  | 'contract-diff';

export type Verdict = {
  bucket: Bucket;
  dataFields: string[];
  contractFields: string[];
  oldVsTruth: 'match' | 'misordered' | 'differs' | 'no-data' | 'na';
  newVsTruth: 'match' | 'misordered' | 'differs' | 'no-data' | 'na';
};

const json = (value: unknown) => JSON.stringify(value);

function rosterOf(rows: readonly Row[]) {
  return rows
    .filter((row) => !row.left_at)
    .map((row) => `${row.user_id}\u0000${row.role}`)
    .sort()
    .join('\u0001');
}

function vsTruth(state: ReaderState, truth: Row[] | undefined) {
  if (!truth) return 'na' as const;
  if (state.isPending || !state.data) return 'no-data' as const;
  if (rosterOf(state.data) !== rosterOf(truth)) return 'differs' as const;
  return inJoinOrder(state.data, truth)
    ? ('match' as const)
    : ('misordered' as const);
}

/** Whether a reader shows anyone. */
const rowsShown = (state: ReaderState) => !!state.data?.length;

/**
 * Whether both readers' last reads failed: the server refused this viewer (a
 * viewer just removed from the channel gets 401 from REST, and the soup read
 * leaves the channel out).
 */
const refused = (snap: Snap) =>
  !snap.old.isPending &&
  !snap.new.isPending &&
  !snap.old.isSuccess &&
  !snap.new.isSuccess;

/** Whether every row the database has carries the database's join time. */
function timesOf(state: ReaderState, truth: Row[] | undefined) {
  if (!truth || state.isPending || !state.data) return false;
  const at = new Map(
    truth.map((row) => [row.user_id, Date.parse(row.joined_at)])
  );
  return state.data.every(
    (row) =>
      !at.has(row.user_id) || Date.parse(row.joined_at) === at.get(row.user_id)
  );
}

/**
 * Whether rows follow the database's join times, earliest first (both reads
 * promise that order). A row the database doesn't have a time for yet (an add
 * in flight) belongs after every row it has.
 */
function inJoinOrder(rows: readonly Row[], truth: readonly Row[]) {
  const at = new Map(
    truth.map((row) => [row.user_id, Date.parse(row.joined_at)])
  );
  const times = rows
    .filter((row) => !row.left_at)
    .map((row) => at.get(row.user_id) ?? Number.NaN)
    .map((t) => (Number.isNaN(t) ? Number.POSITIVE_INFINITY : t));
  return times.every((t, i) => i === 0 || times[i - 1]! <= t);
}

/** Where an add the database has no time for yet sorts: after every row it has. */
const IN_FLIGHT = Number.MAX_SAFE_INTEGER;

const byTimeThenId = (
  x: { t: number; id: string },
  y: { t: number; id: string }
) => x.t - y.t || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
const byJoinThenId = (x: Row, y: Row) =>
  byTimeThenId(
    { t: Date.parse(x.joined_at), id: x.user_id },
    { t: Date.parse(y.joined_at), id: y.user_id }
  );

/** The rows in a canonical order: join time, then user id. */
function canonical(rows: readonly Row[], inFlight: ReadonlySet<string>) {
  return rows
    .map((row) => ({
      t: inFlight.has(row.user_id) ? IN_FLIGHT : Date.parse(row.joined_at),
      id: row.user_id,
    }))
    .sort(byTimeThenId)
    .map((row) => row.id);
}

/**
 * Two orders of the same rows that differ only among rows with the same join
 * time. Main's REST read orders by `joined_at` alone
 * (crates/channels/src/outbound/pg_channels_repo.rs:2191) and the soup read
 * aggregates participants without an order (pg_channels_repo.rs:570), which
 * the client sorts by join time (lib/queries/soup/transform-utils.ts byJoinTime),
 * so neither side defines the order of a tie.
 */
function sameUpToTies(
  a: readonly Row[],
  b: readonly Row[],
  inFlight: ReadonlySet<string>
) {
  const time = (rows: readonly Row[]) =>
    rows.map((row) =>
      inFlight.has(row.user_id) ? IN_FLIGHT : Date.parse(row.joined_at)
    );
  return (
    json(canonical(a, inFlight)) === json(canonical(b, inFlight)) &&
    json(time(a)) === json(time(b))
  );
}

/** A key for a set of rows that has ties, or undefined when every join time differs. */
export function tieKey(rows: readonly Row[] | undefined) {
  if (!rows?.length) return undefined;
  const times = rows.map((row) => Date.parse(row.joined_at));
  if (new Set(times).size === times.length) return undefined;
  return json(
    [...rows]
      .sort(byJoinThenId)
      .map((row) => [row.user_id, row.role, Date.parse(row.joined_at)])
  );
}

/** Contract fields whose value is an order of participants. */
const ORDERED_CONTRACT = new Set([
  'firstOther',
  'dmAgentCandidate',
  'groupLabelIds',
  'mentionIds',
  'topIconIds',
  'tabRows',
  'adapterParticipantIds',
]);

const asBag = (value: unknown) =>
  Array.isArray(value)
    ? json(value.map((item) => json(item)).sort())
    : 'scalar';

/** Names what differs between two readers' outputs, field by field. */
export function dataFields(
  a: ReaderState,
  b: ReaderState,
  truth?: readonly Row[]
): string[] {
  // Rows both readers show with a time of their own making: an add still in
  // flight (the database has no row yet), or one that landed but that each
  // reader still shows with the time it stamped when the add was sent (main's
  // hand-patched cache, the head's overlay). Their times and places among
  // themselves are client clocks, not data.
  const at = (rows: readonly Row[] | undefined) =>
    new Map(
      (rows ?? []).map((row) => [row.user_id, Date.parse(row.joined_at)])
    );
  const [ta, tb, db] = [at(a.data), at(b.data), at(truth)];
  const inFlight = new Set(
    (truth ?? [])
      .filter((row) => {
        const t = Date.parse(row.joined_at);
        return (
          Number.isNaN(t) ||
          (ta.has(row.user_id) &&
            tb.has(row.user_id) &&
            ta.get(row.user_id) !== t &&
            tb.get(row.user_id) !== t)
        );
      })
      .map((row) => row.user_id)
  );
  const out = new Set<string>();
  for (const key of ['isPending', 'isLoading', 'isSuccess'] as const)
    if (a[key] !== b[key]) out.add(`state.${key}`);
  if (!a.data !== !b.data) out.add('data.defined');
  if (a.data && b.data) {
    const ids = (rows: Row[]) => rows.map((row) => row.user_id);
    const [ia, ib] = [ids(a.data), ids(b.data)];
    if (json([...ia].sort()) !== json([...ib].sort())) out.add('rows');
    else if (json(ia) !== json(ib))
      out.add(sameUpToTies(a.data, b.data, inFlight) ? 'order.ties' : 'order');
    const byId = new Map(b.data.map((row) => [row.user_id, row]));
    for (const row of a.data) {
      const other = byId.get(row.user_id);
      if (!other) continue;
      const keys = new Set([...Object.keys(row), ...Object.keys(other)]);
      for (const key of keys) {
        const [x, y] = [
          (row as Record<string, unknown>)[key],
          (other as Record<string, unknown>)[key],
        ];
        if (
          key === 'joined_at' &&
          typeof x === 'string' &&
          typeof y === 'string'
        ) {
          if (inFlight.has(row.user_id) && x !== y)
            out.add('field.joined_at.client-stamped');
          // Main still shows the time it stamped when it sent an add that has
          // landed (its hand-patched cache is never reread); the head shows the
          // database's.
          else if (
            Date.parse(x) !== db.get(row.user_id) &&
            Date.parse(y) === db.get(row.user_id)
          )
            out.add('field.joined_at.main-stamped');
          else if (Date.parse(x) !== Date.parse(y)) out.add('field.joined_at');
          else if (x !== y) out.add('field.joined_at.format');
          continue;
        }
        if (json(x) !== json(y))
          out.add(
            `field.${key}${x === undefined || y === undefined ? '.missing' : ''}`
          );
      }
    }
  }
  return [...out].sort();
}

export function contractFields(
  a: Record<string, unknown>,
  b: Record<string, unknown>
) {
  return Object.keys(a)
    .filter((key) => json(a[key]) !== json(b[key]))
    .sort();
}

export function judge(snap: Snap, truth: Row[] | undefined): Verdict {
  const data = dataFields(snap.old, snap.new, truth);
  const contract = contractFields(snap.oldContract, snap.newContract);
  const oldVsTruth = vsTruth(snap.old, truth);
  const newVsTruth = vsTruth(snap.new, truth);
  let bucket: Bucket = 'same';
  const onlyTies =
    data.includes('order.ties') &&
    !data.includes('rows') &&
    !data.includes('order') &&
    contract.every(
      (key) =>
        ORDERED_CONTRACT.has(key) &&
        asBag(snap.oldContract[key]) === asBag(snap.newContract[key])
    );
  if (contract.length && onlyTies) bucket = 'tie-order';
  else if (contract.length && (!truth || refused(snap))) {
    // The channel is gone, or the server refuses this viewer: the right roster
    // is none, and a side still showing rows kept them from before (TanStack
    // keeps the last data through a failed refetch).
    if (!rowsShown(snap.new) && rowsShown(snap.old)) bucket = 'main-stale';
    else if (rowsShown(snap.new) && !rowsShown(snap.old)) bucket = 'new-wrong';
    else bucket = 'contract-diff';
  } else if (contract.length) {
    if (newVsTruth === 'match' && oldVsTruth !== 'match') bucket = 'main-stale';
    else if (oldVsTruth === 'match' && newVsTruth !== 'match')
      bucket = 'new-wrong';
    // Both hold the database's people in an order its times allow; one still
    // shows join times the database has since changed.
    else if (
      newVsTruth === 'match' &&
      oldVsTruth === 'match' &&
      timesOf(snap.new, truth) !== timesOf(snap.old, truth)
    )
      bucket = timesOf(snap.new, truth) ? 'main-stale' : 'new-wrong';
    else bucket = 'contract-diff';
  } else if (data.length) bucket = 'data-only';
  return {
    bucket,
    dataFields: data,
    contractFields: contract,
    oldVsTruth,
    newVsTruth,
  };
}

/** What a reader should hold while an add or remove is in flight or after it failed. */
export function expectAfter(
  truth: Row[] | undefined,
  op: { kind: 'add' | 'remove'; userIds: string[] },
  applied: boolean
): Row[] | undefined {
  if (!truth || !applied) return truth;
  if (op.kind === 'remove')
    return truth.filter((row) => !op.userIds.includes(row.user_id));
  const have = new Set(truth.map((row) => row.user_id));
  return [
    ...truth,
    ...op.userIds
      .filter((id) => !have.has(id))
      .map((user_id) => ({
        user_id,
        role: 'member',
        joined_at: '',
        left_at: null,
      })),
  ];
}

/** Data fields whose difference is explained, with where the cause lives. */
export const EXPLAINED_FIELDS: Record<string, string> = {
  'field.joined_at.format':
    'join time written "Z" (REST) vs "+00:00" (GraphQL): the same instant',
  'field.left_at.missing':
    "head's REST fallback and overlay rows carry left_at: null; main's rows omit it",
  'field.joined_at.client-stamped':
    'a row both sides show with the time each stamped when the add was sent',
  'field.joined_at.main-stamped':
    "a landed add main still shows with the time it stamped when sending it (main/participants.ts:61); the head shows the database's",
  'order.ties':
    'rows that joined at the same instant, in an order neither read defines',
};

const STATE_FIELDS = new Set([
  'state.isPending',
  'state.isLoading',
  'state.isSuccess',
]);

/**
 * The explained class of a verdict (README.md, "Differences"), or undefined
 * when it has none.
 */
export function explain(verdict: Verdict): string | undefined {
  if (verdict.bucket === 'tie-order') return 'tie-order';
  if (verdict.bucket === 'main-stale') return 'main-stale';
  if (verdict.bucket !== 'data-only') return undefined;
  // Neither reader has rows, and every caller decides the same (the contract
  // reads the flags as each caller does): only the flags differ, such as main
  // still pending where the head's read failed.
  const empty = (vs: Verdict['oldVsTruth']) => vs === 'no-data' || vs === 'na';
  if (
    verdict.dataFields.every((field) => STATE_FIELDS.has(field)) &&
    empty(verdict.oldVsTruth) &&
    empty(verdict.newVsTruth)
  )
    return 'state.both-empty';
  const unexplained = verdict.dataFields.filter(
    (field) => !(field in EXPLAINED_FIELDS)
  );
  if (unexplained.length) return undefined;
  return verdict.dataFields.join('+');
}
