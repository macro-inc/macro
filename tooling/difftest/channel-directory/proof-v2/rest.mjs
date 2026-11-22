// REST and SQL access for the coordinator: passwordless sign-in on the local
// stack, authenticated calls that sign in again when a session expires, the
// primary's REST channel list (the truth every page is compared against), and
// psql on the stack's Postgres.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
export const STACK = process.env.STACK_URL ?? 'https://localhost:29509';
const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function merge(jar, response) {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}
const cookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');

export async function signIn(email) {
  let last;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const jar = new Map();
      const asked = await fetch(`${STACK}/auth/login/passwordless`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, redirect_uri: `${STACK}/app` }),
      });
      const { code } = await asked.json();
      if (!asked.ok || !code) throw new Error(`no code (${asked.status})`);
      const redeemed = await fetch(`${STACK}/auth/oauth/passwordless/${code}?email=${encodeURIComponent(email)}`, { redirect: 'manual' });
      if (redeemed.status !== 303) throw new Error(`redeem ${redeemed.status}`);
      merge(jar, redeemed);
      const tutorial = await fetch(`${STACK}/auth/user/tutorial`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieHeader(jar) },
        body: JSON.stringify({ tutorialComplete: true }),
      });
      merge(jar, tutorial);
      const me = await fetch(`${STACK}/auth/user/me`, { headers: { cookie: cookieHeader(jar) } });
      if (!me.ok) throw new Error(`me ${me.status}`);
      const { user_id: userId } = await me.json();
      return { email, userId, cookies: cookieHeader(jar) };
    } catch (error) {
      last = error;
      await sleep(400 * (attempt + 1));
    }
  }
  throw new Error(`sign in: ${String(last)}`);
}

/** An authenticated call. A 401 signs the person in again once. Returns
 * {status, body, ms}; never throws on 4xx so the caller can record a refused
 * write. */
export async function call(session, path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const started = performance.now();
    let response;
    try {
      response = await fetch(`${STACK}${path}`, {
        method,
        headers: { cookie: session.cookies, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(300 * (attempt + 1));
      continue;
    }
    const text = await response.text();
    const ms = performance.now() - started;
    if (response.status === 401 && attempt === 0) {
      const fresh = await signIn(session.email);
      session.cookies = fresh.cookies;
      continue;
    }
    if (response.status >= 500 && attempt < 3) {
      await sleep(300 * (attempt + 1));
      continue;
    }
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text.slice(0, 300);
    }
    return { status: response.status, body: parsed, ms };
  }
  throw new Error(`${method} ${path}: retries exhausted`);
}

/** The viewer's whole REST channel list and activity, read from the primary. */
export async function restTruth(session) {
  const started = Date.now();
  const rows = [];
  let cursor = null;
  do {
    const query = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const page = await call(session, `/dss/comms/channels${query}`);
    if (page.status !== 200) throw new Error(`list ${page.status} ${JSON.stringify(page.body).slice(0, 200)}`);
    rows.push(...page.body.items);
    cursor = page.body.next_cursor;
  } while (cursor);
  const activity = await call(session, '/dss/channels/activity');
  if (activity.status !== 200) throw new Error(`activity ${activity.status}`);
  return { at: started, ms: Date.now() - started, rows, activity: activity.body };
}

const PG = 'macro-gqlchan-postgres-1';
export async function psql(sql, { port = 5432 } = {}) {
  const { stdout } = await run('docker', ['exec', '-i', PG, 'psql', '-U', 'user', '-d', 'macrodb', '-p', String(port), '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function primaryLsn() {
  return psql('select pg_current_wal_lsn()');
}

/** Waits until the lagging replica has replayed `lsn`; returns the wait. */
export async function waitReplica(lsn, timeoutMs = 30_000) {
  const started = Date.now();
  for (;;) {
    const replayed = await psql(`select pg_last_wal_replay_lsn() >= '${lsn}'::pg_lsn`, { port: 5433 });
    if (replayed === 't') return Date.now() - started;
    if (Date.now() - started > timeoutMs) throw new Error(`replica behind ${lsn}`);
    await sleep(150);
  }
}

const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;

/**
 * The DM get_or_create_dm reuses for a pair, read on the primary with the
 * server's own rule: `find_dm` (crates/channels/src/outbound/pg_channels_repo/
 * historical.rs:238, before the removed-bot fix), which `ensure_dm` runs before it creates one (:204).
 * Same SQL, read-only. Null when get-or-create would create a new DM.
 */
export async function serverDm(a, b) {
  const id = await psql(`
    SELECT c.id
    FROM (
        (SELECT p.channel_id FROM comms_channel_participants p WHERE p.user_id = ${sqlText(a)} AND p.left_at IS NULL
         UNION ALL
         SELECT p.channel_id FROM comms_channel_participants p WHERE p.user_id = ${sqlText(a)} AND p.left_at IS NOT NULL)
        INTERSECT
        (SELECT p.channel_id FROM comms_channel_participants p WHERE p.user_id = ${sqlText(b)} AND p.left_at IS NULL
         UNION ALL
         SELECT p.channel_id FROM comms_channel_participants p WHERE p.user_id = ${sqlText(b)} AND p.left_at IS NOT NULL)
        OFFSET 0
    ) shared
    JOIN comms_channels c ON c.id = shared.channel_id
    WHERE c.channel_type = 'direct_message'
      AND (SELECT COUNT(*) FROM comms_channel_participants p WHERE p.channel_id = c.id) = 2
    ORDER BY c.created_at, c.id
    LIMIT 1`);
  return id || null;
}

/** A channel's rows on the primary, by kind: what decides whether a DM is reused. */
export async function channelRows(channelId) {
  const json = await psql(`
    select json_build_object(
      'type', (select channel_type from comms_channels where id = ${sqlText(channelId)}::uuid),
      'rows', count(*),
      'activePeople', coalesce(json_agg(p.user_id order by p.user_id) filter (where p.left_at is null and p.user_id not like 'bot|%'), '[]'),
      'activeBots', count(*) filter (where p.left_at is null and p.user_id like 'bot|%'),
      'leftBots', count(*) filter (where p.left_at is not null and p.user_id like 'bot|%'),
      'leftPeople', count(*) filter (where p.left_at is not null and p.user_id not like 'bot|%'))
    from comms_channel_participants p where p.channel_id = ${sqlText(channelId)}::uuid`);
  return JSON.parse(json);
}
