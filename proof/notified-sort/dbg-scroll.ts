import { join } from 'node:path';
import { launchBrowser, openLane, startApp, stopApp } from './lib/browser.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';
const here = import.meta.dirname;
const out = join(here, 'out/smoke');
const stack = stackFromEnv();
const env = { backendProxy: stack.proxyUrl, routes: process.env.PROOF_ROUTES ?? '', caPem: process.env.PROOF_CA_PEM ?? '', hostname: process.env.PROOF_HOSTNAME ?? 'localhost' };
const seeded = await seedWorld(stack, { seed: 902, lanes: 1, sizes: [], outDir: out, repo: process.env.PROOF_REPO ?? '', instance: 'gqlns', log: console.log, reuse: true });
const app = await startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out);
const browser = await launchBrowser();
try {
  for (const touch of [true, false]) {
    const lane = await openLane(browser, app, seeded.users.get('v0')!, { touch });
    await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 });
    await lane.page.waitForTimeout(4000);
    const info = await lane.page.evaluate(() => {
      const grid = document.querySelector('[role="grid"][aria-label="Home"]') as HTMLElement;
      const out: unknown[] = [];
      const all = [grid, ...grid.querySelectorAll('*')] as HTMLElement[];
      let el: HTMLElement | null = grid.parentElement;
      while (el) { all.push(el); el = el.parentElement; }
      for (const e of all) {
        const s = getComputedStyle(e);
        if (e.scrollHeight > e.clientHeight + 2) out.push({ tag: e.tagName, cls: e.className.toString().slice(0, 80), oy: s.overflowY, sh: e.scrollHeight, ch: e.clientHeight, inGrid: grid.contains(e) });
      }
      return { rows: grid.querySelectorAll('[role="row"]').length, ariaRowCount: grid.getAttribute('aria-rowcount'), out: out.slice(0, 15), doc: [document.scrollingElement?.scrollHeight, innerHeight] };
    });
    console.log(touch ? 'touch' : 'desk', JSON.stringify(info, null, 1));
    await lane.context.close();
  }
} finally {
  await browser.close();
  stopApp(app);
}
