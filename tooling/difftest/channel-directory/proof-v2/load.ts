// Concurrent load on the gqlchan stack while a differential run goes on:
// messages posted into the v1 seed's channels (people disjoint from the v2
// groups and buckets under test), the heavy viewer's REST channel list paged
// end to end, and the heavy viewer's GraphQL channel lane paged end to end, all
// at once. It never writes to a v2 viewer's channels, so the run under test
// compares the same data; it only shares the database, the services and the
// event pipeline with it.
//
// Usage: bun load.ts --out FILE [--seconds N] [--msg-per-s 4]
//                    [--rest-walkers 2] [--soup-walkers 2]
// Stops after --seconds, or on SIGTERM/SIGINT; writes FILE every 10 s.
import { BRANCH_LANE, pageInput } from '../docs';
import { call, graphql, type Session } from '../lib';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const out = args.get('out') ?? 'load.json';
const seconds = Number(args.get('seconds') ?? 0);
const msgPerSecond = Number(args.get('msg-per-s') ?? 4);
const restWalkers = Number(args.get('rest-walkers') ?? 2);
const soupWalkers = Number(args.get('soup-walkers') ?? 2);

const sessions = (await Bun.file(new URL('../sessions.json', import.meta.url)).json()) as Session[];
const heavy = sessions[0]!;
const posters = sessions.slice(1);

type Kind = 'message' | 'restPage' | 'restWalk' | 'soupPage' | 'soupWalk';
const samples: Record<Kind, number[]> = { message: [], restPage: [], restWalk: [], soupPage: [], soupWalk: [] };
const errors: Record<string, number> = {};
const startedAt = Date.now();
let stopping = false;

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!);
}

function summary() {
  const elapsed = (Date.now() - startedAt) / 1000;
  return {
    startedAt: new Date(startedAt).toISOString(),
    elapsedS: Math.round(elapsed),
    config: { msgPerSecond, restWalkers, soupWalkers },
    counts: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, v.length])),
    perSecond: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, Number((v.length / Math.max(elapsed, 1)).toFixed(2))])),
    ms: Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, { p50: percentile(v, 50), p95: percentile(v, 95), max: percentile(v, 100) }])),
    errors,
  };
}

const fail = (kind: string, error: unknown) => {
  const key = `${kind}: ${String(error).slice(0, 80)}`;
  errors[key] = (errors[key] ?? 0) + 1;
};

// Each poster's own joined channels, from their first REST page.
const channelsOf = new Map<Session, string[]>();
await Promise.all(posters.map(async (person) => {
  const page = await call<{ items: { id: string }[] }>(person, '/dss/comms/channels?limit=100');
  channelsOf.set(person, page.body.items.map((item) => item.id));
}));

async function postLoop() {
  const interval = 1000 / msgPerSecond;
  let n = 0;
  while (!stopping) {
    const next = startedAt + ++n * interval;
    const person = posters[n % posters.length]!;
    const ids = channelsOf.get(person) ?? [];
    if (ids.length) {
      const id = ids[(n * 7919) % ids.length]!;
      const started = performance.now();
      call(person, `/dss/messages/channel/${id}`, {
        method: 'POST',
        body: { content: `load ${n}`, thread_id: null, nonce: crypto.randomUUID(), mentions: [] },
      }).then(
        () => samples.message.push(performance.now() - started),
        (error) => fail('message', error)
      );
    }
    await Bun.sleep(Math.max(0, next - Date.now()));
  }
}

async function restLoop() {
  while (!stopping) {
    const walk = performance.now();
    let cursor: string | null = null;
    try {
      do {
        const query = `?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
        const page = await call<{ items: unknown[]; next_cursor: string | null }>(heavy, `/dss/comms/channels${query}`);
        samples.restPage.push(page.ms);
        cursor = page.body.next_cursor;
      } while (cursor && !stopping);
      samples.restWalk.push(performance.now() - walk);
    } catch (error) {
      fail('rest', error);
    }
  }
}

async function soupLoop() {
  while (!stopping) {
    const walk = performance.now();
    let cursor: string | null = null;
    try {
      do {
        type Data = { user: { soup: { items: unknown[]; nextCursor: string | null } } };
        const page = await graphql<Data>(heavy, BRANCH_LANE, { input: pageInput(cursor) });
        samples.soupPage.push(page.ms);
        cursor = page.body.user.soup.nextCursor;
      } while (cursor && !stopping);
      samples.soupWalk.push(performance.now() - walk);
    } catch (error) {
      fail('soup', error);
    }
  }
}

const write = () => Bun.write(out, `${JSON.stringify(summary(), null, 2)}\n`);
const ticker = setInterval(() => { write().catch(() => {}); }, 10_000);
const stop = () => { stopping = true; };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
if (seconds > 0) setTimeout(stop, seconds * 1000);

console.log(`load: ${posters.length} posters at ${msgPerSecond}/s, ${restWalkers} REST walkers, ${soupWalkers} soup walkers`);
await Promise.all([
  postLoop(),
  ...Array.from({ length: restWalkers }, restLoop),
  ...Array.from({ length: soupWalkers }, soupLoop),
]);
clearInterval(ticker);
await Bun.sleep(2000);
await write();
console.log(`load done: ${JSON.stringify(summary().counts)}`);
