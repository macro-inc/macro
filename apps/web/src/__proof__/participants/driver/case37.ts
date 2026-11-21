// Case 37 on purpose. The first differential once saw a member of a public
// channel get rows from main's REST reader and "no record" from the head's
// reader, and could not reproduce it. Here each suspected cause is made to
// happen: the by-id GraphQL read (ChannelParticipantsSoup) delayed, failed once,
// failed for good, answered with GraphQL errors; main's REST read failed; both
// under concurrent load; and a reader opening on a stale cache entry. Each
// scenario runs on a fresh channel (so no cached by-id result) and samples
// both readers every 200 ms.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Page, type Route } from 'playwright';
import { judge, type Row, type Snap } from './compare';
import {
  clearSignUpCounter,
  dss,
  gotoRetrying,
  hungCalls,
  login,
  lostCalls,
  ORIGIN,
  px,
  sleep,
  sql,
} from './stack';

const env = process.env;
const RUN = env.PX_RUN ?? `c37${Date.now().toString(36)}`;
const OUT = env.PX_OUT ?? `/tmp/px-${RUN}`;
const REPEATS = Number(env.PX_REPEATS ?? 5);
const WATCH_MS = Number(env.PX_WATCH_MS ?? 15_000);
/** Run only the scenarios whose name contains this. */
const ONLY = env.PX_ONLY ?? '';
const DOMAIN = `${RUN}.example.com`;
const email = (name: string) => `${name}@${DOMAIN}`;
const userId = (name: string) => `macro|${email(name)}`;

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const log = (line: string) => {
  const text = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ${line}`;
  console.log(text);
  appendFileSync(`${OUT}/log.txt`, `${text}\n`);
};

let setupReloads = 0;
/**
 * Loads the harness into a page. Chromium aborts module requests now and then
 * on this machine and keeps a failed module import failed for the document,
 * so a failed install reloads the page and tries again.
 */
async function installOn(page: Page, who: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForLoadState('load');
      await px(page, 'install', userId(who));
      return;
    } catch (error) {
      if (attempt >= 8) throw error;
      setupReloads += 1;
      log(`${who} setup failed, reloading: ${String(error).split('\n')[0]}`);
      await sleep(1000);
      await page.reload({ timeout: 90_000 }).catch(() => undefined);
    }
  }
}

type Fault =
  | { kind: 'none' }
  | { kind: 'delay'; ms: number }
  | { kind: 'http-500'; times: number }
  | { kind: 'graphql-error'; times: number }
  | { kind: 'abort'; times: number };

type Scenario = {
  name: string;
  /** What happens to the head's by-id read of the channel. */
  byId: Fault;
  /** What happens to main's REST read of the channel's participants. */
  rest: Fault;
  load?: boolean;
};

const SCENARIOS: Scenario[] = [
  { name: 'baseline', byId: { kind: 'none' }, rest: { kind: 'none' } },
  {
    name: 'by-id delayed 6 s',
    byId: { kind: 'delay', ms: 6000 },
    rest: { kind: 'none' },
  },
  {
    name: 'by-id 500 once',
    byId: { kind: 'http-500', times: 1 },
    rest: { kind: 'none' },
  },
  {
    name: 'by-id 500 always',
    byId: { kind: 'http-500', times: 1e9 },
    rest: { kind: 'none' },
  },
  {
    name: 'by-id GraphQL error once',
    byId: { kind: 'graphql-error', times: 1 },
    rest: { kind: 'none' },
  },
  {
    name: 'by-id connection dropped once',
    byId: { kind: 'abort', times: 1 },
    rest: { kind: 'none' },
  },
  {
    name: 'REST 500 once',
    byId: { kind: 'none' },
    rest: { kind: 'http-500', times: 1 },
  },
  {
    name: 'REST 500 always',
    byId: { kind: 'none' },
    rest: { kind: 'http-500', times: 1e9 },
  },
  {
    name: 'under load',
    byId: { kind: 'none' },
    rest: { kind: 'none' },
    load: true,
  },
  {
    name: 'under load, by-id 500 once',
    byId: { kind: 'http-500', times: 1 },
    rest: { kind: 'none' },
    load: true,
  },
  {
    name: 'under load, by-id delayed 6 s',
    byId: { kind: 'delay', ms: 6000 },
    rest: { kind: 'none' },
    load: true,
  },
];

type Sample = {
  t: number;
  old: string;
  new: string;
  verdict: string;
  same: boolean;
};
type Outcome = {
  scenario: string;
  repeat: number;
  channel: string;
  byIdHits: number;
  restHits: number;
  firstOldData: number | null;
  firstNewData: number | null;
  /** The case-37 shape: main shows the roster, head settled with none. */
  case37Ms: number;
  contractDiffMs: number;
  finalSame: boolean;
  finalNewVsTruth: string;
  timeline: Sample[];
};

function describe(state: Snap['old']) {
  if (state.isPending) return 'pending';
  if (!state.data)
    return state.isSuccess ? 'success, no data' : 'settled, no data';
  return `${state.data.length} rows`;
}

async function fulfilFault(route: Route, fault: Fault, hits: number) {
  if (fault.kind === 'delay') {
    await sleep(fault.ms);
    return route.continue();
  }
  if (fault.kind === 'none' || hits > fault.times) return route.continue();
  if (fault.kind === 'abort') return route.abort('connectionreset');
  if (fault.kind === 'http-500')
    return route.fulfill({
      status: 500,
      contentType: 'text/plain',
      body: 'injected',
    });
  return route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: null,
      errors: [
        { message: 'injected', extensions: { code: 'INTERNAL_SERVER_ERROR' } },
      ],
    }),
  });
}

async function startLoad(page: Page, channels: string[], noise: string[]) {
  await page.evaluate(
    ({ channels, noise, origin }) => {
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
      for (let worker = 0; worker < 32; worker++) {
        (async () => {
          while (w.__load) {
            const id = pick(channels);
            const roll = Math.random();
            if (roll < 0.3)
              await go(`/channels/${id}/participants`, 'POST', {
                participants: [pick(noise)],
              });
            else if (roll < 0.55)
              await go(`/channels/${id}/participants`, 'DELETE', {
                participants: [pick(noise)],
              });
            else await go(`/channels/${id}/participants`, 'GET');
            w.__loadOps! += 1;
          }
        })().catch(() => undefined);
      }
    },
    { channels, noise, origin: ORIGIN }
  );
}

async function stopLoad(page: Page) {
  return await page.evaluate(() => {
    const w = window as unknown as { __load?: boolean; __loadOps?: number };
    w.__load = false;
    return w.__loadOps ?? 0;
  });
}

const browser = await chromium.launch({
  args: ['--ignore-certificate-errors'],
});
const newContext = () =>
  browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });

try {
  clearSignUpCounter();
  const ownerContext = await newContext();
  const memberContext = await newContext();
  const outsiderContext = await newContext();
  const loadContext = await newContext();
  const owner = await login(ownerContext, email('owner'), false, log);
  const member = await login(memberContext, email('member'), true, log);
  member.on('framenavigated', (frame) => {
    if (frame === member.mainFrame())
      log(`member page navigated to ${frame.url()}`);
  });
  const requestFailed: Record<string, number> = {};
  member.on('requestfailed', (request) => {
    const key = `${request.method()} ${new URL(request.url()).pathname.replace(/[0-9a-f-]{36}/g, ':id')} ${request.failure()?.errorText ?? 'unknown'}`;
    requestFailed[key] = (requestFailed[key] ?? 0) + 1;
  });
  member.on('console', (message) => {
    if (/reload|stall|unauthor|version/i.test(message.text()))
      log(`member console: ${message.text().slice(0, 300)}`);
  });
  const outsider = await login(outsiderContext, email('outsider'), true, log);
  const loader = await login(loadContext, email('load'), false, log);
  const noise = ['n1', 'n2', 'n3'].map(userId);
  const noiseChannels: string[] = [];
  for (let i = 0; i < 12; i++) {
    const made = await dss<{ id: string }>(loader, '/channels', 'POST', {
      channel_type: 'private',
      name: `noise ${i}`,
      participants: [userId('member'), userId('owner')],
    });
    if (made.body?.id) noiseChannels.push(made.body.id);
  }

  const outcomes: Outcome[] = [];
  async function runScenario(scenario: Scenario, repeat: number) {
    const made = await dss<{ id: string }>(owner, '/channels', 'POST', {
      channel_type: 'public',
      name: `case 37 ${scenario.name} ${repeat}`,
      participants: [userId('member')],
    });
    const id = made.body.id;
    const truth = JSON.parse(
      sql(`select coalesce(json_agg(json_build_object('user_id', user_id, 'role', role, 'joined_at', joined_at)), '[]')
        from comms_channel_participants where channel_id = '${id}' and left_at is null`)
    ) as Row[];
    let byIdHits = 0;
    let restHits = 0;
    const byId = async (route: Route) => {
      const body = route.request().postData() ?? '';
      if (!body.includes('ChannelParticipantsSoup') || !body.includes(id))
        return route.continue();
      byIdHits += 1;
      return fulfilFault(route, scenario.byId, byIdHits);
    };
    const rest = async (route: Route) => {
      if (route.request().method() !== 'GET') return route.continue();
      restHits += 1;
      return fulfilFault(route, scenario.rest, restHits);
    };
    await memberContext.route('**/dss/items/soup/graphql', byId);
    await memberContext.route(`**/dss/channels/${id}/participants`, rest);
    if (scenario.load) await startLoad(loader, noiseChannels, noise);
    await px(member, 'mount', [{ id, type: 'public' }]).catch(async () => {
      // The page reloaded under the run: install the harness again.
      await installOn(member, 'member');
      await px(member, 'mount', [{ id, type: 'public' }]);
    });
    const start = Date.now();
    const timeline: Sample[] = [];
    let firstOldData: number | null = null;
    let firstNewData: number | null = null;
    let case37Ms = 0;
    let contractDiffMs = 0;
    let last: Snap | undefined;
    while (Date.now() - start < WATCH_MS) {
      const snap = (
        await px<Record<string, Snap | null>>(member, 'snapshot', [id])
      )[id];
      const t = Date.now() - start;
      if (snap) {
        last = snap;
        const verdict = judge(snap, truth);
        const same = verdict.contractFields.length === 0;
        if (firstOldData === null && snap.old.data && !snap.old.isPending)
          firstOldData = t;
        if (firstNewData === null && snap.new.data && !snap.new.isPending)
          firstNewData = t;
        if (snap.old.data && !snap.new.data && !snap.new.isPending)
          case37Ms += 200;
        if (!same) contractDiffMs += 200;
        const previous = timeline.at(-1);
        const entry = {
          t,
          old: describe(snap.old),
          new: describe(snap.new),
          verdict: verdict.bucket,
          same,
        };
        if (
          !previous ||
          previous.old !== entry.old ||
          previous.new !== entry.new ||
          previous.verdict !== entry.verdict
        )
          timeline.push(entry);
      }
      await sleep(200);
    }
    if (scenario.load) log(`  load sent ${await stopLoad(loader)} requests`);
    await px(member, 'unmount', [id]);
    await memberContext.unroute('**/dss/items/soup/graphql', byId);
    await memberContext.unroute(`**/dss/channels/${id}/participants`, rest);
    const final = last ? judge(last, truth) : undefined;
    const outcome: Outcome = {
      scenario: scenario.name,
      repeat,
      channel: id,
      byIdHits,
      restHits,
      firstOldData,
      firstNewData,
      case37Ms,
      contractDiffMs,
      finalSame: !!final && final.contractFields.length === 0,
      finalNewVsTruth: final?.newVsTruth ?? 'none',
      timeline,
    };
    outcomes.push(outcome);
    log(
      `${scenario.name} #${repeat}: by-id hits ${byIdHits}, REST hits ${restHits}; data old ${firstOldData}ms new ${firstNewData}ms; ` +
        `case-37 shape for ${case37Ms}ms; final ${outcome.finalSame ? 'same' : 'differs'} (new ${outcome.finalNewVsTruth}); ` +
        timeline.map((s) => `${s.t}:${s.old}|${s.new}`).join(' → ')
    );
  }

  await gotoRetrying(member, `${ORIGIN}/app/home`);
  await installOn(member, 'member');
  for (const scenario of SCENARIOS.filter((s) => s.name.includes(ONLY)))
    for (let repeat = 0; repeat < REPEATS; repeat++)
      await runScenario(scenario, repeat);

  // A stale cache entry: the outsider reads a public channel before joining
  // (head: the by-id read has no channel, so REST fallback), joins (neither
  // side patches its cache on join), then a reader mounts again in the same
  // page, and again after a reload that restores the persisted cache.
  const stale: Record<string, unknown>[] = [];
  await gotoRetrying(outsider, `${ORIGIN}/app/home`);
  await outsider.waitForLoadState('load');
  for (let repeat = 0; repeat < REPEATS; repeat++) {
    const made = await dss<{ id: string }>(owner, '/channels', 'POST', {
      channel_type: 'public',
      name: `case 37 stale ${repeat}`,
      participants: [userId('member')],
    });
    const id = made.body.id;
    await installOn(outsider, 'outsider');
    await px(outsider, 'mount', [{ id, type: 'public' }]);
    await px(outsider, 'settle', [id], 20_000);
    const before = (await px<Record<string, Snap>>(outsider, 'snapshot', [id]))[
      id
    ]!;
    await px(outsider, 'unmount', [id]);
    const joined = await dss(outsider, `/channels/${id}/join`, 'POST');
    const truth = JSON.parse(
      sql(`select coalesce(json_agg(json_build_object('user_id', user_id, 'role', role, 'joined_at', joined_at)), '[]')
        from comms_channel_participants where channel_id = '${id}' and left_at is null`)
    ) as Row[];
    await px(outsider, 'mount', [{ id, type: 'public' }]);
    await px(outsider, 'settle', [id], 20_000);
    const remount = (
      await px<Record<string, Snap>>(outsider, 'snapshot', [id])
    )[id]!;
    let remountNewMatchMs: number | null = null;
    for (let t = 0; t < 10_000; t += 200) {
      const snap = (await px<Record<string, Snap>>(outsider, 'snapshot', [id]))[
        id
      ]!;
      if (judge(snap, truth).newVsTruth === 'match') {
        remountNewMatchMs = t;
        break;
      }
      await sleep(200);
    }
    const afterRemount = (
      await px<Record<string, Snap>>(outsider, 'snapshot', [id])
    )[id]!;
    await px(outsider, 'unmount', [id]);
    await outsider.reload();
    await installOn(outsider, 'outsider');
    await px(outsider, 'mount', [{ id, type: 'public' }]);
    await px(outsider, 'settle', [id], 20_000);
    const reloaded = (
      await px<Record<string, Snap>>(outsider, 'snapshot', [id])
    )[id]!;
    await px(outsider, 'unmount', [id]);
    const row = {
      repeat,
      channel: id,
      joinStatus: joined.status,
      before: {
        old: describe(before.old),
        new: describe(before.new),
        verdict: judge(before, truth).bucket,
      },
      remount: {
        ...judge(remount, truth),
        old: describe(remount.old),
        new: describe(remount.new),
      },
      remountNewMatchMs,
      afterRemount: {
        ...judge(afterRemount, truth),
        old: describe(afterRemount.old),
        new: describe(afterRemount.new),
      },
      reloaded: {
        ...judge(reloaded, truth),
        old: describe(reloaded.old),
        new: describe(reloaded.new),
      },
    };
    stale.push(row);
    log(`stale #${repeat}: ${JSON.stringify(row)}`);
  }

  const summary = SCENARIOS.map((scenario) => {
    const rows = outcomes.filter((o) => o.scenario === scenario.name);
    return {
      scenario: scenario.name,
      runs: rows.length,
      byIdHits: rows.map((o) => o.byIdHits),
      restHits: rows.map((o) => o.restHits),
      case37Runs: rows.filter((o) => o.case37Ms > 0).length,
      case37Ms: rows.map((o) => o.case37Ms),
      newRecovered: rows.filter((o) => o.finalNewVsTruth === 'match').length,
      finalSame: rows.filter((o) => o.finalSame).length,
      firstOldData: rows.map((o) => o.firstOldData),
      firstNewData: rows.map((o) => o.firstNewData),
    };
  });
  writeFileSync(
    `${OUT}/case37.json`,
    JSON.stringify(
      {
        run: RUN,
        repeats: REPEATS,
        watchMs: WATCH_MS,
        lostCalls,
        hungCalls,
        setupReloads,
        summary,
        stale,
        outcomes,
      },
      null,
      2
    )
  );
  for (const row of summary) log(JSON.stringify(row));
} finally {
  await browser.close();
}
