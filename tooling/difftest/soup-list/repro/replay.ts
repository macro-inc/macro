/**
 * Replays one reader on main's app and the branch's, signed in as an existing
 * synthetic user, and prints both results, every failed HTTP response and
 * every GraphQL response that carries errors:
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
      const graphql = new URL(r.url()).pathname.endsWith('/graphql');
      if (r.status() < 400 && !graphql) return;
      const body = await r.text().catch(() => '');
      // GraphQL reports field errors with HTTP 200: print those too.
      if (r.status() < 400) {
        if (!body.includes('"errors"')) return;
        const op = (r.request().postDataJSON() as { operationName?: string } | null)?.operationName;
        console.log(`[${side}] GraphQL ${op} errors: ${JSON.stringify(JSON.parse(body).errors).slice(0, 600)}`);
        return;
      }
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
  // The browser exports spans in batches: give the last ones time to arrive.
  await session.pages.new.waitForTimeout(10_000);
  // Every Soup request each app sent, with the part of its input that tells
  // the reader under test from the app's own lists (sidebar, quick access).
  for (const side of ['old', 'new'] as const) {
    const lines = session.requests[side].map((r) => {
      let input: Record<string, unknown> | undefined;
      try {
        input = JSON.parse(r.body ?? '{}').variables?.input;
      } catch {}
      const initial = (input?.initial ?? input) as Record<string, unknown> | undefined;
      const brief = initial && { sort: initial.sortMethod, limit: initial.limit, filters: Object.keys((initial.filters as object) ?? {}) };
      return `${r.kind}${r.op ? ` ${r.op}` : ''}${brief ? ` ${JSON.stringify(brief)}` : ''}`;
    });
    console.log(`[${side}] Soup requests:\n  ${lines.join('\n  ')}`);
  }
  console.log(`branch fallback spans: ${JSON.stringify(session.spans.new.filter((s) => s.name === 'soup.rest_fallback').map((s) => s.attributes))}`);
  await session.context.close();
} finally {
  await closeBrowser();
}
