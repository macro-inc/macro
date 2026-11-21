/**
 * Replays one reader on main's app and the branch's, signed in as an existing
 * synthetic user, and prints both results and every failed HTTP response:
 *
 *   bun run repro/replay.ts --email <user> --caller ast --params case.json [--oneshot] [--repeat 3]
 *
 * The Vites run.sh serves must be up (ports as in run.sh).
 */
import { parseArgs } from 'node:util';
import { closeBrowser, launch, openUser } from '../lib/browser';
import { mount, oneShot, settle, unmount } from '../lib/probe';

const { values: a } = parseArgs({
  options: {
    email: { type: 'string' },
    caller: { type: 'string' },
    params: { type: 'string' },
    oneshot: { type: 'boolean', default: false },
    repeat: { type: 'string', default: '1' },
    new: { type: 'string', default: 'http://localhost:23250' },
    old: { type: 'string', default: 'http://localhost:23251' },
  },
});
const params = JSON.parse(await Bun.file(a.params!).text());
const b = await launch();
try {
  const session = await openUser(b, { new: a.new!, old: a.old! }, a.email!, {
    new: '/src/difftest-probe/new.tsx',
    old: '/src/difftest-probe/old.tsx',
  });
  for (const side of ['old', 'new'] as const) {
    session.pages[side].on('pageerror', (e) => console.log(`[${side}] pageerror ${String(e).slice(0, 300)}`));
    session.pages[side].on('response', async (r) => {
      if (r.status() < 400) return;
      const body = await r.text().catch(() => '');
      console.log(`[${side}] HTTP ${r.status()} ${new URL(r.url()).pathname} ${body.slice(0, 400)}`);
    });
  }
  for (let i = 0; i < Number(a.repeat); i++) {
    const out: Record<string, unknown> = {};
    if (a.oneshot) {
      const [o, n] = await Promise.all((['old', 'new'] as const).map((s) => oneShot(session.pages[s], a.caller!, params)));
      Object.assign(out, { old: o, new: n });
    } else {
      const key = `rp${i}`;
      await Promise.all((['old', 'new'] as const).map((s) => mount(session.pages[s], key, a.caller!, params)));
      const [o, n] = await Promise.all((['old', 'new'] as const).map((s) => settle(session.pages[s], key, { timeoutMs: 60_000 })));
      Object.assign(out, { old: o, new: n });
      await Promise.all((['old', 'new'] as const).map((s) => unmount(session.pages[s], key)));
    }
    console.log(`run ${i}: ${JSON.stringify(out, (_k, v) => (Array.isArray(v) && v.length > 6 ? [`${v.length} items`, ...v.slice(0, 2)] : v)).slice(0, 3000)}`);
  }
  const graphql = session.requests.new.filter((r) => r.kind === 'graphql').map((r) => r.op);
  console.log(`branch Soup requests: ${JSON.stringify(session.requests.new.map((r) => r.kind))} graphql ops ${JSON.stringify(graphql)}`);
  console.log(`branch fallback spans: ${JSON.stringify(session.spans.new.filter((s) => s.name === 'soup.rest_fallback').map((s) => s.attributes))}`);
  await session.context.close();
} finally {
  await closeBrowser();
}
