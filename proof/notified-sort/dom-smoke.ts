// Finds how Home's tabs are reached and checks the DOM reader on both apps.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser, openLane, readHomeDom, startApp, stopApp } from './lib/browser.ts';
import { compareDom } from './lib/compare.ts';
import { seedWorld } from './lib/setup.ts';
import { stackFromEnv } from './lib/stack.ts';

const here = import.meta.dirname;
const out = join(here, 'out/smoke');
mkdirSync(out, { recursive: true });
const stack = stackFromEnv();
const env = {
  backendProxy: stack.proxyUrl,
  routes: process.env.PROOF_ROUTES ?? '',
  caPem: process.env.PROOF_CA_PEM ?? '',
  hostname: process.env.PROOF_HOSTNAME ?? 'localhost',
};
const seeded = await seedWorld(stack, {
  seed: Number(process.env.PROOF_SEED ?? 902),
  lanes: 1,
  sizes: [],
  outDir: out,
  repo: process.env.PROOF_REPO ?? '',
  instance: 'gqlns',
  log: console.log,
  reuse: true,
});
const [oldApp, newApp] = await Promise.all([
  startApp('old', process.env.PROOF_OLD_WORKTREE ?? '', 30110, env, join(here, 'probe.ts'), out),
  startApp('new', process.env.PROOF_NEW_WORKTREE ?? '', 30111, env, join(here, 'probe.ts'), out),
]);
const browser = await launchBrowser();
try {
  const viewer = seeded.users.get('v0')!;
  for (const touch of [true]) {
    const lanes = await Promise.all([openLane(browser, oldApp, viewer, { touch }), openLane(browser, newApp, viewer, { touch })]);
    for (const lane of lanes) {
      await lane.page.getByRole('grid', { name: 'Home' }).waitFor({ timeout: 180_000 }).catch((e) => console.log('no grid', String(e).slice(0, 200)));
      await lane.page.waitForTimeout(2000);
      const tabs = await lane.page.getByRole('tab').allTextContents();
      const buttons = await lane.page.getByRole('button', { name: /noise/i }).count();
      console.log(lane.side, touch ? 'touch' : 'desktop', 'url', lane.page.url(), 'tabs', JSON.stringify(tabs), 'noiseButtons', buttons);
      await lane.page.screenshot({ path: join(out, `home-${lane.side}-${touch ? 'touch' : 'desk'}.png`) });
    }
    for (const tab of ['Signal', 'Noise']) {
      for (const lane of lanes) {
        const target = lane.page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') });
        if (await target.count()) await target.first().click();
        else await lane.page.getByRole('button', { name: new RegExp(`^${tab}`, 'i') }).first().click();
        await lane.page.waitForTimeout(3000);
        console.log(lane.side, tab, lane.page.url());
      }
      const [a, b] = await Promise.all(lanes.map((lane) => readHomeDom(lane)));
      console.log(touch ? 'touch' : 'desktop', tab, 'rows', a.length, b.length);
      writeFileSync(join(out, `dom-${tab}-old.json`), JSON.stringify(a, null, 1));
      writeFileSync(join(out, `dom-${tab}-new.json`), JSON.stringify(b, null, 1));
      console.log(JSON.stringify(compareDom(a, b, tab)).slice(0, 1500));
      await lanes[0].page.screenshot({ path: join(out, `home-${tab}-old-${touch ? 'touch' : 'desk'}.png`) });
      await lanes[1].page.screenshot({ path: join(out, `home-${tab}-new-${touch ? 'touch' : 'desk'}.png`) });
    }
    for (const lane of lanes) await lane.context.close();
  }
} finally {
  await browser.close();
  stopApp(oldApp);
  stopApp(newApp);
}
