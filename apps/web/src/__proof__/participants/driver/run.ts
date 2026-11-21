// Differential driver for the channel participants reader: main's REST reader
// and hand-patched mutations against the head's GraphQL reader, overlay and
// REST fallback, in the same signed-in pages over the same local stack.
// Run through ../run.sh; every knob is an env var (see README.md).
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { type BrowserContext, chromium, type Page } from 'playwright';
import {
  expectAfter,
  explain,
  judge,
  type Row,
  type Snap,
  tieKey,
} from './compare';
import {
  type ChannelPlan,
  type Op,
  planChannel,
  planOp,
  rng,
  SIZE_COUNTS,
  type U,
} from './gen';
import {
  auth,
  clearSignUpCounter,
  dss,
  gotoRetrying,
  hungCalls,
  lit,
  lostCalls,
  ORIGIN,
  px,
  login as signIn,
  sleep,
  sql,
} from './stack';

const env = process.env;
const SEED = Number(env.PX_SEED ?? 1);
const LOAD = env.PX_LOAD === '1';
const SEQS = Number(env.PX_SEQS ?? 100);
const STEPS = Number(env.PX_STEPS ?? 24);
const BATCH = Number(env.PX_BATCH ?? 50);
const LIVE_MS = Number(env.PX_LIVE_MS ?? 5000);
// How long, from a write, a reader still out of step at LIVE_MS keeps being
// read: one that catches up by then with no reload got its update late; one
// that never does lost it.
const LATE_MS = Number(env.PX_LATE_MS ?? 30_000);
const MUTANT = env.PX_MUTANT ?? 'none';
const FORMS_EVERY = Number(env.PX_FORMS_EVERY ?? 6);
const RUN =
  env.PX_RUN ?? `s${SEED}${LOAD ? 'l' : 'q'}${Date.now().toString(36)}`;
const OUT = env.PX_OUT ?? `/tmp/px-${RUN}`;
/** Pages that stay open and act. */
const ACTORS = 4;
/** One more viewer whose page is closed while others write: it reopens on a stale persisted cache. */
const LATE = ACTORS;
const VIEWERS = ACTORS + 1;
const USERS = 10;

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (line: string) => {
  const text = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`;
  console.log(text);
  appendFileSync(`${OUT}/log.txt`, `${text}\n`);
};
// A domain of its own per run: a team auto-joins its creator's domain, which must be unique.
const DOMAIN = `${RUN}.example.com`;
const email = (u: number) => `px${u}@${DOMAIN}`;
const userId = (u: number) => `macro|${email(u)}`;

// ---------------------------------------------------------------- browser

type Viewer = { u: U; context: BrowserContext; page: Page | undefined };

async function openViewer(viewer: Viewer, channels: Channel[]) {
  if (!viewer.page) {
    viewer.page = await viewer.context.newPage();
    watchRequests(viewer.page);
  }
  const page = viewer.page;
  if (page.url().includes('/app/')) await page.reload({ timeout: 90_000 });
  else await gotoRetrying(page, `${ORIGIN}/app/home`);
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState('load');
      await px(page, 'install', userId(viewer.u));
      await px(page, 'setMutant', MUTANT);
      await px(
        page,
        'mount',
        channels.map((c) => ({ id: c.id, type: c.plan.type }))
      );
      return;
    } catch (error) {
      // The page reloaded under the harness, or a module request failed while
      // it loaded (Chromium aborts requests with ERR_NETWORK_CHANGED when
      // Docker bridges come and go, and keeps a failed module import failed
      // for the rest of the document): load the page again.
      if (attempt >= 8) throw error;
      counts.selfNavigations += 1;
      log(
        `u${viewer.u} setup failed, reloading (${page.url()}): ${String(error).split('\n')[0]}`
      );
      await sleep(1000);
      await page.reload({ timeout: 90_000 }).catch(() => undefined);
    }
  }
}

/** Counts every failed request by its error, so network faults during a run are on record. */
function watchRequests(page: Page) {
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? 'unknown';
    const kind = /graphql/.test(request.url())
      ? 'graphql'
      : /\/dss\//.test(request.url())
        ? 'rest'
        : 'other';
    bump(
      slot(counts.requestFailed, kind, () => ({})),
      error
    );
  });
}

// ---------------------------------------------------------------- state

type Channel = {
  seq: number;
  id: string;
  plan: ChannelPlan;
  members: Set<U>;
  everMember: Set<U>;
  deleted: boolean;
  steps: number;
};

type Truth = Map<string, Row[] | undefined>;

/**
 * The user ids both servers return: each parses a participant's id as
 * `macro|<ASCII email>` and drops the row when that fails, REST at
 * crates/channels/src/outbound/pg_channels_repo.rs:2201 and the soup read at
 * crates/models_soup/src/comms.rs:470 (grammar: crates/macro_user_id/src/email.rs).
 * A row the database holds under any other id is in neither answer.
 */
const SERVER_USER_ID =
  /^macro\|[A-Za-z0-9!#%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

function readTruth(ids: string[]): Truth {
  const out: Truth = new Map(ids.map((id) => [id, undefined]));
  if (!ids.length) return out;
  const list = ids.map(lit).join(',');
  const text = sql(`select coalesce(json_object_agg(c, r), '{}') from (
      select c.id::text c, coalesce((select json_agg(json_build_object('user_id', p.user_id, 'role', p.role,
        'joined_at', p.joined_at, 'left_at', p.left_at) order by p.joined_at, p.user_id)
        from comms_channel_participants p where p.channel_id = c.id and p.left_at is null), '[]') r
      from comms_channels c where c.id::text in (${list})) t`);
  for (const [id, rows] of Object.entries(
    JSON.parse(text) as Record<string, Row[]>
  ))
    out.set(
      id,
      rows.filter((row) => SERVER_USER_ID.test(row.user_id))
    );
  return out;
}

// ---------------------------------------------------------------- records

const counts = {
  reads: 0,
  sequences: 0,
  steps: 0,
  byMode: {} as Record<string, number>,
  byBucket: {} as Record<string, number>,
  signatures: {} as Record<string, { count: number; first: string }>,
  coverage: {} as Record<string, Record<string, number>>,
  ops: {} as Record<string, Record<string, number>>,
  live: {
    converged: 0,
    timedOut: 0,
    /** Timed-out checks by op, then how the head and main each compared to the database. */
    timedOutBy: {} as Record<string, number>,
    newBehindMain: 0,
    mainStale: 0,
    latencies: [] as number[],
  },
  reload: { firstSettledWrong: 0, convergedAfter: [] as number[] },
  forms: { cases: 0, same: 0, diffs: 0 },
  selfNavigations: 0,
  /** Harness calls Chromium dropped and the driver made again (driver/stack.ts px). */
  lostCalls,
  /** Harness calls the page never answered (driver/stack.ts px). */
  hungCalls,
  /** Failed requests in the viewers' pages, by kind and error. */
  requestFailed: {} as Record<string, Record<string, number>>,
  /** Per channel and set of rows with tied join times: how many distinct orders each side showed across reads. */
  tieOrders: {
    rowSets: 0,
    mainSeveral: 0,
    headSeveral: 0,
    mainFirstSeveral: '',
    headFirstSeveral: '',
  },
};
const tieOrders = new Map<string, { old: Set<string>; new: Set<string> }>();
function noteTieOrder(
  channel: string,
  side: 'old' | 'new',
  rows: Row[] | undefined
) {
  const raw = tieKey(rows);
  const key = raw && createHash('sha1').update(raw).digest('hex');
  if (!key || !rows) return;
  const entry = tieOrders.get(`${channel} ${key}`) ?? {
    old: new Set<string>(),
    new: new Set<string>(),
  };
  if (!tieOrders.has(`${channel} ${key}`)) {
    tieOrders.set(`${channel} ${key}`, entry);
    counts.tieOrders.rowSets += 1;
  }
  const before = entry[side].size;
  entry[side].add(
    createHash('sha1')
      .update(rows.map((row) => row.user_id).join(','))
      .digest('hex')
  );
  if (before === 1 && entry[side].size === 2) {
    if (side === 'old') {
      counts.tieOrders.mainSeveral += 1;
      counts.tieOrders.mainFirstSeveral ||= channel;
    } else {
      counts.tieOrders.headSeveral += 1;
      counts.tieOrders.headFirstSeveral ||= channel;
    }
  }
}
/** The entry for a key, made on first use. */
function slot<T>(table: Record<string, T>, key: string, make: () => T): T {
  if (!(key in table)) table[key] = make();
  return table[key] as T;
}

const bump = (table: Record<string, number>, key: string, by = 1) => {
  table[key] = (table[key] ?? 0) + by;
};
const cover = (dimension: string, value: string) => {
  counts.coverage[dimension] ??= {};
  bump(counts.coverage[dimension]!, value);
};

function permissionOf(channel: Channel, u: U, truth: Row[] | undefined) {
  if (channel.deleted || truth === undefined) return 'deleted';
  const row = truth.find((r) => r.user_id === userId(u));
  if (row)
    return row.role === 'owner'
      ? 'owner'
      : row.role === 'admin'
        ? 'admin'
        : 'member';
  if (channel.everMember.has(u)) return 'revoked';
  if (channel.plan.type === 'public') return 'public-unjoined';
  if (channel.plan.type === 'team') return 'team-nonmember';
  return 'private-nonmember';
}

function sizeOf(rows: Row[] | undefined) {
  const n = rows?.length ?? 0;
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n < 10) return '2-9';
  if (n < 99) return '10-98';
  if (n <= 101) return '99-101 (page)';
  if (n < 1000) return '102-999';
  return '1000+';
}

function oddsOf(rows: Row[] | undefined) {
  const out: string[] = [];
  if (!rows) return out;
  const times = rows.map((r) => r.joined_at);
  if (new Set(times).size < times.length) out.push('ties');
  if (rows.some((r) => /[^\x20-\x7e]/.test(r.user_id))) out.push('unicode-id');
  if (rows.some((r) => r.user_id.length > 120)) out.push('long-id');
  if (rows.some((r) => !r.user_id.startsWith('macro|')))
    out.push('non-user-id');
  return out;
}

function record(
  mode: string,
  viewer: U,
  channel: Channel,
  snap: Snap | null,
  truth: Row[] | undefined,
  op: Op,
  extra: Record<string, unknown> = {}
) {
  if (!snap) return;
  const verdict = judge(snap, truth);
  counts.reads += 1;
  if (!snap.old.isPending) noteTieOrder(channel.id, 'old', snap.old.data);
  if (!snap.new.isPending) noteTieOrder(channel.id, 'new', snap.new.data);
  bump(counts.byMode, mode);
  bump(counts.byBucket, `${mode} ${verdict.bucket}`);
  cover('mode', mode);
  cover('permission', permissionOf(channel, viewer, truth));
  cover('channel type', channel.plan.type);
  cover('size', sizeOf(truth));
  cover('op', op.kind + ('fail' in op && op.fail ? ' (failed)' : ''));
  for (const odd of oddsOf(truth)) cover('odd value', odd);
  cover(
    'odd value',
    `channel name ${channel.plan.name.length > 100 ? 'long' : /[^\x20-\x7e]/.test(channel.plan.name) ? 'unicode' : 'plain'}`
  );
  cover(
    'reader state',
    snap.old.isPending || snap.new.isPending
      ? 'pending'
      : snap.new.data
        ? 'data'
        : 'no data'
  );
  if (verdict.bucket === 'same') return verdict;
  const signature = `${mode} | ${verdict.bucket} | contract: ${verdict.contractFields.join(',') || '-'} | data: ${verdict.dataFields.join(',') || '-'} | truth old ${verdict.oldVsTruth} new ${verdict.newVsTruth}`;
  const entry = slot(counts.signatures, signature, () => ({
    count: 0,
    first: '',
  }));
  entry.count += 1;
  const line = JSON.stringify({
    signature,
    mode,
    seed: SEED,
    load: LOAD,
    seq: channel.seq,
    step: channel.steps,
    viewer: `u${viewer}`,
    channel: channel.id,
    plan: channel.plan,
    op,
    truth,
    snap,
    ...extra,
  });
  if (!entry.first) entry.first = `${OUT}/records.jsonl:${counts.reads}`;
  appendFileSync(`${OUT}/records.jsonl`, `${line}\n`);
  return verdict;
}

// ---------------------------------------------------------------- setup

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors'],
});
const newContext = () =>
  browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
const viewers: Viewer[] = [];
const others: Page[] = [];
const r = rng(SEED);
let botId = '';
let teamId = '';
let stopLoad = () => {};

async function setup() {
  clearSignUpCounter();
  const signedIn = await Promise.all(
    [...Array(USERS).keys()].map(async (u) => {
      const context = await newContext();
      return {
        u,
        context,
        page: await signIn(context, email(u), u < VIEWERS, log),
      };
    })
  );
  for (const { u, context, page } of signedIn) {
    if (u < VIEWERS) viewers.push({ u, context, page });
    else others.push(page);
  }
  const owner = viewers[0]!.page!;
  const team = await auth<{ id: string }>(owner, '/team', 'POST', {
    name: `Proof team ${RUN}`,
  });
  teamId = team.body.id;
  const link = await auth<{ token: string }>(
    owner,
    '/team/invite-link',
    'POST'
  );
  for (const u of [1, 2, 5, 6, 7]) {
    const page = u < VIEWERS ? viewers[u]!.page! : others[u - VIEWERS]!;
    const joined = await auth(page, '/team/invite-link/join', 'POST', {
      token: link.body.token,
    });
    if (joined.status >= 300)
      log(`u${u} could not join the team: ${joined.status}`);
  }
  const bot = await dss<{ id: string }>(owner, '/bots', 'POST', {
    handle: `proofbot${RUN}`.slice(0, 30),
    name: 'Proof bot',
    team_id: teamId,
  });
  botId = bot.body?.id ?? '';
  log(
    `run ${RUN}: ${USERS} users, team ${teamId} (${team.status}), bot ${botId || bot.status}`
  );
}

async function startLoad() {
  // Another user hammers the same services: noise channels with the viewers in
  // them (so their sockets and caches churn), membership writes, REST and soup reads.
  const context = await newContext();
  const page = await signIn(context, `load@load-${DOMAIN}`, false, log);
  const ids: string[] = [];
  for (let i = 0; i < 16; i++) {
    const made = await dss<{ id: string }>(page, '/channels', 'POST', {
      channel_type: 'private',
      name: `noise ${i}`,
      participants: viewers.map((v) => userId(v.u)),
    });
    if (made.body?.id) ids.push(made.body.id);
  }
  const extra = [5, 6, 7, 8, 9].map(userId);
  await page.evaluate(
    ({ ids, extra, origin }) => {
      const w = window as unknown as { __load?: boolean; __loadOps?: number };
      w.__load = true;
      w.__loadOps = 0;
      const pick = <T>(a: T[]) => a[Math.floor(Math.random() * a.length)]!;
      const go = (path: string, method: string, body?: unknown) =>
        fetch(`${origin}/dss${path}`, {
          method,
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        }).then(
          (r) => r.text(),
          () => ''
        );
      for (let worker = 0; worker < 24; worker++) {
        (async () => {
          while (w.__load) {
            const id = pick(ids);
            const roll = Math.random();
            if (roll < 0.3)
              await go(`/channels/${id}/participants`, 'POST', {
                participants: [pick(extra)],
              });
            else if (roll < 0.55)
              await go(`/channels/${id}/participants`, 'DELETE', {
                participants: [pick(extra)],
              });
            else if (roll < 0.7)
              await go(`/channels/${id}`, 'PATCH', {
                channel_name: `noise ${Math.random()}`,
              });
            else await go(`/channels/${id}/participants`, 'GET');
            w.__loadOps! += 1;
          }
        })().catch(() => undefined);
      }
    },
    { ids, extra, origin: ORIGIN }
  );
  log(`load: 24 writers over ${ids.length} noise channels`);
  stopLoad = () => {
    page
      .evaluate(() => {
        (window as unknown as { __load?: boolean }).__load = false;
      })
      .catch(() => {});
  };
  return page;
}

// ---------------------------------------------------------------- channels

async function createChannel(
  seq: number,
  plan: ChannelPlan
): Promise<Channel | undefined> {
  const page = viewers[plan.owner]!.page!;
  const body: Record<string, unknown> = {
    channel_type: plan.type,
    name: plan.type === 'direct_message' ? undefined : `${plan.name} ${seq}`,
    // The server wants someone besides the owner listed; listing the owner alone gives an owner-only channel.
    participants: (plan.initial.length ? plan.initial : [plan.owner]).map(
      userId
    ),
  };
  if (plan.type === 'team') {
    body.team_id = teamId;
    body.auto_join_team = false;
  }
  const made = await dss<{ id: string }>(page, '/channels', 'POST', body);
  if (!made.body?.id) {
    log(
      `seq ${seq}: create ${plan.type} refused ${made.status} ${JSON.stringify(made.body).slice(0, 200)}`
    );
    return undefined;
  }
  const id = made.body.id;
  const synthetic = SIZE_COUNTS[plan.size] - plan.initial.length;
  if (plan.size === 'page' || plan.size === 'thousands')
    sql(`insert into comms_channel_participants (channel_id, role, user_id, joined_at)
      select '${id}', 'member', 'macro|bulk' || g || '-${RUN}@example.com', now() - (g || ' seconds')::interval
      from generate_series(1, ${Math.max(0, synthetic)}) g`);
  if (plan.odd === 'unicode')
    sql(
      `insert into comms_channel_participants (channel_id, role, user_id) values ('${id}', 'member', ${lit(`macro|ünï-${seq}-${RUN}@exämple.com`)})`
    );
  if (plan.odd === 'long-id')
    sql(
      `insert into comms_channel_participants (channel_id, role, user_id) values ('${id}', 'member', ${lit(`macro|${'l'.repeat(200)}-${seq}-${RUN}@example.com`)})`
    );
  if (plan.odd === 'left-rows')
    sql(
      `insert into comms_channel_participants (channel_id, role, user_id, left_at) values ('${id}', 'member', ${lit(`macro|left-${seq}-${RUN}@example.com`)}, now())`
    );
  if (plan.odd === 'same-instant-add')
    sql(`insert into comms_channel_participants (channel_id, role, user_id, joined_at)
      select '${id}', 'member', 'macro|same' || g || '-${seq}@${DOMAIN}', (select min(joined_at) from comms_channel_participants where channel_id = '${id}')
      from generate_series(1, 2) g`);
  if (plan.odd === 'ties')
    sql(
      `update comms_channel_participants set joined_at = date_trunc('second', now()) where channel_id = '${id}'`
    );
  const members = new Set<U>([plan.owner, ...plan.initial]);
  return {
    seq,
    id,
    plan,
    members,
    everMember: new Set(members),
    deleted: false,
    steps: 0,
  };
}

// ---------------------------------------------------------------- one step

const pageOf = (u: U) => (u < VIEWERS ? viewers[u]!.page : others[u - VIEWERS]);

async function snapshot(
  u: U,
  ids: string[]
): Promise<Record<string, Snap | null>> {
  const page = viewers[u]?.page;
  if (!page || !ids.length) return {};
  return await px(page, 'snapshot', ids);
}

type Outcome = { ok: boolean; status?: number; note?: string };

async function runOther(channel: Channel, op: Op): Promise<Outcome> {
  const id = channel.id;
  switch (op.kind) {
    case 'leave':
    case 'join': {
      const page = pageOf(op.actor)!;
      const result = await dss(page, `/channels/${id}/${op.kind}`, 'POST');
      return { ok: result.status < 300, status: result.status };
    }
    case 'request-approve': {
      const asker = pageOf(op.requester)!;
      const request = await dss<{ id: string }>(
        asker,
        `/channels/${id}/access-requests/mine`,
        'PUT'
      );
      if (request.status >= 300 || !request.body?.id)
        return { ok: false, status: request.status, note: 'request refused' };
      const done = await px<{ ok: boolean; error?: string }>(
        viewers[op.actor]!.page!,
        'write',
        { kind: 'approve', channelId: id, requestId: request.body.id }
      );
      return { ok: done.ok, note: done.error };
    }
    case 'autojoin': {
      if (channel.plan.type !== 'team')
        return { ok: false, note: 'not a team channel' };
      const done = await px<{ ok: boolean; error?: string }>(
        viewers[op.actor]!.page!,
        'write',
        { kind: 'autojoin', channelId: id, on: op.on }
      );
      return { ok: done.ok, note: done.error };
    }
    case 'add-bot':
    case 'remove-bot': {
      if (!botId) return { ok: false, note: 'no bot' };
      const done = await px<{ ok: boolean; error?: string }>(
        viewers[op.actor]!.page!,
        'write',
        {
          kind: op.kind === 'add-bot' ? 'bot-add' : 'bot-remove',
          channelId: id,
          botId,
        }
      );
      return { ok: done.ok, note: done.error };
    }
    case 'delete': {
      const done = await px<{ ok: boolean; error?: string }>(
        viewers[op.actor]!.page!,
        'write',
        { kind: 'delete', channelId: id }
      );
      if (done.ok) channel.deleted = true;
      return { ok: done.ok, note: done.error };
    }
    case 'role':
      sql(
        `update comms_channel_participants set role = '${op.role}' where channel_id = '${id}' and user_id = ${lit(userId(op.user))} and role <> 'owner'`
      );
      return { ok: true };
    case 'ties':
      sql(
        `update comms_channel_participants set joined_at = date_trunc('second', now()) where channel_id = '${id}'`
      );
      return { ok: true };
    case 'synthetic': {
      const prefix = op.unicode ? 'macro|ñ-用户' : 'macro|syn';
      sql(`insert into comms_channel_participants (channel_id, role, user_id)
        select '${id}', 'member', ${lit(prefix)} || '-' || g || '-${channel.steps}-${RUN}@example.com' from generate_series(1, ${op.count}) g`);
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

function actorOf(op: Op): U | undefined {
  if ('actor' in op && op.actor < ACTORS) return op.actor;
  return undefined;
}

async function step(batch: Channel[], round: number) {
  const live = batch.filter((c) => !c.deleted || c.steps < STEPS);
  const ops = new Map<string, Op>();
  for (const channel of live) {
    const op = planOp(
      r,
      channel.plan,
      channel.members,
      round,
      STEPS,
      USERS,
      ACTORS,
      channel.deleted
    );
    ops.set(channel.id, op);
    const table = slot(counts.ops, op.kind, () => ({}));
    bump(table, 'planned');
  }
  const ids = live.map((c) => c.id);
  const before = readTruth(ids);

  // Adds and removes go through both sides' mutations, held at the network
  // so the in-flight state can be read, then released (or failed).
  const acts = live.filter((c) => {
    const op = ops.get(c.id)!;
    return op.kind === 'add' || op.kind === 'remove';
  });
  const byActor = new Map<U, Channel[]>();
  for (const channel of acts) {
    const actor = actorOf(ops.get(channel.id)!)!;
    byActor.set(actor, [...(byActor.get(actor) ?? []), channel]);
  }
  const actResults: Record<
    string,
    { ok: boolean; calls: number; error?: string }
  > = {};
  await Promise.all(
    [...byActor].map(async ([actor, channels]) => {
      const page = viewers[actor]!.page!;
      await px(
        page,
        'startActs',
        channels.map((c) => {
          const op = ops.get(c.id) as Extract<Op, { kind: 'add' | 'remove' }>;
          return {
            id: c.id,
            act: {
              kind: op.kind,
              channelId: c.id,
              userIds: op.users.map(userId),
              fail: op.fail,
            },
          };
        })
      );
      await sleep(30);
      const pending = await snapshot(
        actor,
        channels.map((c) => c.id)
      );
      for (const channel of channels) {
        const op = ops.get(channel.id) as Extract<
          Op,
          { kind: 'add' | 'remove' }
        >;
        const expected = expectAfter(
          before.get(channel.id),
          { kind: op.kind, userIds: op.users.map(userId) },
          true
        );
        record(
          'pending',
          actor,
          channel,
          pending[channel.id] ?? null,
          expected,
          op
        );
      }
      Object.assign(
        actResults,
        await px(
          page,
          'releaseActs',
          channels.map((c) => c.id)
        )
      );
    })
  );
  // The other writes, all channels at once.
  const otherResults = new Map<string, Outcome>();
  await Promise.all(
    live
      .filter((c) => !acts.includes(c))
      .map(async (c) => {
        const op = ops.get(c.id)!;
        try {
          otherResults.set(c.id, await runOther(c, op));
        } catch (error) {
          otherResults.set(c.id, {
            ok: false,
            note: String(error).slice(0, 200),
          });
        }
      })
  );
  const after = readTruth(ids);
  for (const channel of live) {
    const op = ops.get(channel.id)!;
    const ok = acts.includes(channel)
      ? actResults[channel.id]?.ok
      : otherResults.get(channel.id)?.ok;
    bump(counts.ops[op.kind]!, ok ? 'applied' : 'refused');
    if (after.get(channel.id) === undefined) channel.deleted = true;
    const rows = after.get(channel.id) ?? [];
    channel.members = new Set(
      [...Array(USERS).keys()].filter((u) =>
        rows.some((row) => row.user_id === userId(u))
      )
    );
    for (const u of channel.members) channel.everMember.add(u);
  }

  // Read-after-write: the actor's own reader, straight after its write.
  const byWriter = new Map<U, Channel[]>();
  for (const channel of live) {
    const actor = actorOf(ops.get(channel.id)!);
    if (actor === undefined) continue;
    byWriter.set(actor, [...(byWriter.get(actor) ?? []), channel]);
  }
  await Promise.all(
    [...byWriter].map(async ([actor, channels]) => {
      const snaps = await snapshot(
        actor,
        channels.map((c) => c.id)
      );
      for (const channel of channels) {
        const op = ops.get(channel.id)!;
        const failed =
          (op.kind === 'add' || op.kind === 'remove') &&
          !actResults[channel.id]?.ok;
        record(
          'read-after-write',
          actor,
          channel,
          snaps[channel.id] ?? null,
          after.get(channel.id),
          op,
          {
            outcome: acts.includes(channel)
              ? actResults[channel.id]
              : otherResults.get(channel.id),
            failed,
          }
        );
      }
    })
  );

  // Live: every open reader, polled until the new side matches the database
  // or LIVE_MS passes; the final snapshot is compared.
  await Promise.all(
    viewers.slice(0, ACTORS).map(async (viewer) => {
      const start = Date.now();
      const waiting = new Set(ids);
      let last: Record<string, Snap | null> = {};
      const converged = new Map<string, number>();
      while (waiting.size && Date.now() - start < LIVE_MS) {
        const snaps = await snapshot(viewer.u, [...waiting]);
        for (const id of [...waiting]) {
          const snap = snaps[id] ?? null;
          last[id] = snap;
          const truth = after.get(id);
          if (!snap || !truth) {
            waiting.delete(id);
            continue;
          }
          const verdict = judge(snap, truth);
          // Settled once the new side matches the database or has nothing to show.
          if (
            verdict.newVsTruth === 'match' &&
            (verdict.bucket === 'same' ||
              verdict.bucket === 'data-only' ||
              verdict.bucket === 'tie-order' ||
              verdict.bucket === 'main-stale')
          ) {
            converged.set(id, Date.now() - start);
            waiting.delete(id);
          } else if (
            verdict.newVsTruth === 'no-data' &&
            !snap.new.isPending &&
            !snap.old.isPending &&
            verdict.bucket !== 'new-wrong' &&
            Date.now() - start > 1500
          ) {
            waiting.delete(id);
          }
        }
        if (waiting.size) await sleep(100);
      }
      // Past the bound, the snapshot taken at it is the one compared; a read
      // still differing unexplained keeps being read until it catches up or
      // LATE_MS passes, and the record says when (the report's `live.late`).
      const caughtUp = new Map<string, number>();
      const unsettled = (id: string, snap: Snap | null | undefined) => {
        if (!snap) return false;
        const verdict = judge(snap, after.get(id));
        return verdict.bucket !== 'same' && !explain(verdict);
      };
      let behind = live
        .map((channel) => channel.id)
        .filter((id) => unsettled(id, last[id]));
      while (behind.length && Date.now() - start < LATE_MS) {
        await sleep(250);
        const snaps = await snapshot(viewer.u, behind);
        for (const id of behind)
          if (snaps[id] && !unsettled(id, snaps[id]))
            caughtUp.set(id, Date.now() - start);
        behind = behind.filter((id) => !caughtUp.has(id));
      }
      for (const channel of live) {
        const snap = last[channel.id] ?? null;
        const verdict = record(
          'live',
          viewer.u,
          channel,
          snap,
          after.get(channel.id),
          ops.get(channel.id)!,
          {
            liveMs: converged.get(channel.id) ?? null,
            boundMs: LIVE_MS,
            caughtUpMs: caughtUp.get(channel.id) ?? null,
            lateBoundMs: LATE_MS,
          }
        );
        if (!verdict) continue;
        if (converged.has(channel.id)) {
          counts.live.converged += 1;
          counts.live.latencies.push(converged.get(channel.id)!);
        } else if (
          verdict.newVsTruth !== 'match' &&
          verdict.newVsTruth !== 'na'
        ) {
          counts.live.timedOut += 1;
          const why = `${ops.get(channel.id)!.kind}: head ${verdict.newVsTruth}, main ${verdict.oldVsTruth}`;
          counts.live.timedOutBy[why] = (counts.live.timedOutBy[why] ?? 0) + 1;
          // Main matched the database where the head did not: a live update the head missed.
          if (verdict.oldVsTruth === 'match') counts.live.newBehindMain += 1;
        }
        if (verdict.bucket === 'main-stale') counts.live.mainStale += 1;
      }
    })
  );

  // Reload: every page reloads (the late viewer reopens on the persisted cache
  // it closed with), remounts, and its first settled read is compared.
  await Promise.all(
    viewers.map(async (viewer) => {
      await openViewer(viewer, batch);
      const page = viewer.page!;
      await px(page, 'settle', ids, 30_000);
      const start = Date.now();
      const snaps = await snapshot(viewer.u, ids);
      for (const channel of live) {
        const verdict = record(
          'reload',
          viewer.u,
          channel,
          snaps[channel.id] ?? null,
          after.get(channel.id),
          ops.get(channel.id)!,
          {
            late: viewer.u === LATE,
          }
        );
        if (verdict && verdict.newVsTruth === 'differs') {
          counts.reload.firstSettledWrong += 1;
          // How long the new side takes to correct itself.
          for (let waited = 0; waited < LIVE_MS; waited += 100) {
            await sleep(100);
            const again = (await snapshot(viewer.u, [channel.id]))[channel.id];
            if (
              again &&
              judge(again, after.get(channel.id)).newVsTruth === 'match'
            ) {
              counts.reload.convergedAfter.push(Date.now() - start);
              break;
            }
          }
        }
      }
      if (viewer.u === LATE) {
        await page.close();
        viewer.page = undefined;
      }
    })
  );
  for (const channel of live) channel.steps += 1;
  counts.steps += live.length;
}

// ---------------------------------------------------------------- forms

type Form = { id: string; owner: U; channels: string[] };

async function makeForms(batch: Channel[]) {
  const forms: Form[] = [];
  for (let owner = 0; owner < ACTORS; owner++) {
    for (let i = 0; i < 2; i++) {
      const page = viewers[owner]!.page!;
      const made = await dss<{ form: { id: string } }>(page, '/forms', 'POST', {
        name: `Reach ${RUN} ${owner}.${i}`,
        source: { kind: 'new' },
      });
      const formId = made.body?.form?.id;
      if (!formId) continue;
      const picks = r.some(batch, 3);
      const shared: string[] = [];
      for (const channel of picks) {
        const result = await dss(
          page,
          `/forms/${formId}/permissions`,
          'PATCH',
          {
            channelSharePermissions: [
              { channelId: channel.id, accessLevel: 'view', operation: 'add' },
            ],
          }
        );
        if (result.status < 300) shared.push(channel.id);
      }
      forms.push({ id: formId, owner, channels: shared });
    }
  }
  return forms;
}

async function compareForms(forms: Form[]) {
  for (const form of forms) {
    const page = viewers[form.owner]!.page!;
    const result = await px<{
      old: { reach: unknown; failure: unknown };
      new: { reach: unknown; failure: unknown };
    }>(page, 'invited', form.id, userId(form.owner), 20_000);
    const truth = form.channels.length
      ? Number(
          sql(`select count(distinct user_id) from comms_channel_participants where left_at is null
          and channel_id::text in (${form.channels.map(lit).join(',')}) and user_id <> ${lit(userId(form.owner))}`)
        )
      : null;
    counts.forms.cases += 1;
    cover(
      'form',
      form.channels.length === 0
        ? 'shared nowhere'
        : `${form.channels.length} channel(s)`
    );
    const same = JSON.stringify(result.old) === JSON.stringify(result.new);
    if (same) counts.forms.same += 1;
    else {
      counts.forms.diffs += 1;
      const signature = `forms | old ${typeof result.old.reach} new ${typeof result.new.reach} | ${result.old.reach === truth ? 'old=truth' : 'old≠truth'} ${result.new.reach === truth ? 'new=truth' : 'new≠truth'}`;
      const entry = slot(counts.signatures, signature, () => ({
        count: 0,
        first: '',
      }));
      entry.count += 1;
      appendFileSync(
        `${OUT}/records.jsonl`,
        `${JSON.stringify({ signature, form, truth, result })}\n`
      );
    }
  }
}

// ---------------------------------------------------------------- main

try {
  writeFileSync(
    `${OUT}/config.json`,
    JSON.stringify(
      { RUN, SEED, LOAD, SEQS, STEPS, BATCH, LIVE_MS, LATE_MS, MUTANT, ORIGIN },
      null,
      2
    )
  );
  await setup();
  const loadPage = LOAD ? await startLoad() : undefined;
  for (let first = 0; first < SEQS; first += BATCH) {
    const plans = Array.from({ length: Math.min(BATCH, SEQS - first) }, () =>
      planChannel(r, USERS, ACTORS)
    );
    const batch = (
      await Promise.all(plans.map((plan, i) => createChannel(first + i, plan)))
    ).filter((c): c is Channel => !!c);
    counts.sequences += batch.length;
    for (const viewer of viewers) await openViewer(viewer, batch);
    const forms = await makeForms(batch);
    log(
      `batch ${first / BATCH}: ${batch.length} channels, ${forms.length} forms`
    );
    for (let round = 0; round < STEPS; round++) {
      await step(batch, round);
      if ((round + 1) % FORMS_EVERY === 0) await compareForms(forms);
      const bad = Object.entries(counts.byBucket)
        .filter(([k]) => !k.endsWith(' same'))
        .map(([k, v]) => `${k}=${v}`);
      log(
        `batch ${first / BATCH} round ${round}: ${counts.reads} reads; ${bad.join(' ') || 'all same'}`
      );
      writeFileSync(`${OUT}/summary.json`, JSON.stringify(counts, null, 2));
    }
    // Readers of the next batch mount on a fresh reload (openViewer), so a page
    // that reloaded under the harness here loses nothing.
    for (const viewer of viewers)
      if (viewer.page)
        await px(
          viewer.page,
          'unmount',
          batch.map((c) => c.id)
        ).catch((error) =>
          log(`u${viewer.u} unmount skipped: ${String(error).split('\n')[0]}`)
        );
  }
  if (loadPage) {
    const ops = await loadPage.evaluate(
      () => (window as unknown as { __loadOps?: number }).__loadOps
    );
    log(`load generated ${ops} requests`);
    (counts as Record<string, unknown>).loadRequests = ops;
  }
} finally {
  stopLoad();
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(counts, null, 2));
  log(
    `done: ${counts.sequences} sequences, ${counts.steps} steps, ${counts.reads} reads -> ${OUT}`
  );
  await browser.close();
}
