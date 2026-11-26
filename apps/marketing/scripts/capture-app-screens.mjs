// Captures the product pages' app screens from the meta-ads tutorial sets: the
// Macro app's real components running on made-up data, in a browser.
//
// Each shot reaches its state once, is captured in Macro Dark, then switched in
// the same page to Macro Light and captured again at the same size and crop, so
// a light frame shares its dark frame's DOM and `focus` rectangle. A shot with a
// `focus` (capture pixels) also gets a 400x700 narrow pair for phones: the
// element under the focus is measured again after the window narrows.
//
//   MACRO=<app checkout> ADS=<meta-ads checkout> \
//     node scripts/capture-app-screens.mjs <set> <scenes.mjs> [shot,shot...]
//
// Writes <set>-<shot>-{dark,light}.png and <set>-<shot>-narrow-{dark,light}.png
// at 2x into OUT (default ./app-screens-out), and prints a NARROW line with the
// measured narrow focus. See the README's "App screens" section for the app
// revision the sets build against and how to update the site's WebP files.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MACRO = process.env.MACRO;
const ADS = process.env.ADS;
if (!MACRO || !ADS) {
  console.error('Set MACRO (app checkout) and ADS (meta-ads checkout).');
  process.exit(1);
}
const [set, scenesFile, only] = process.argv.slice(2);
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright');
const OUT = path.resolve(process.env.OUT || 'app-screens-out');
const NARROW = { width: 400, height: 700 };
// The sets' dates are written for this moment.
const CLOCK = '2026-11-03T15:00:00Z';

// Copy the set into the app so Vite resolves the app's own modules.
const src = `${ADS}/tutorials/macro-${set}/set`;
const dest = `${MACRO}/apps/web/src/.video-set/macro-${set}-${process.env.SUFFIX || 'screens'}`;
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true, filter: (s) => !s.includes('/.vite') });
fs.cpSync(`${ADS}/daily-video/_kit/real/people`, `${dest}/people`, { recursive: true });
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === '.vite' || e.name === 'people' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );
const rewrite = (fn) => {
  for (const f of walk(dest)) {
    if (!/\.(ts|tsx|html|json|mjs)$/.test(f)) continue;
    const text = fs.readFileSync(f, 'utf8');
    const next = fn(text);
    if (next !== text) fs.writeFileSync(f, next);
  }
};
// The sets were written in a checkout at /home/user/macro.
rewrite((t) => t.replaceAll('/home/user/macro/', `${MACRO}/`));

const scenes = await import(path.resolve(scenesFile));
const edit = (rel, fn) => {
  const p = path.join(dest, rel);
  if (fs.existsSync(p)) fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
};
edit('index.html', (s) =>
  s.includes('name="viewport"')
    ? s
    : s.replace(
        '<meta charset="utf-8" />',
        '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no, interactive-widget=resizes-visual" />'
      )
);
// Start in Macro Dark and let the driver switch the same page to Macro Light.
edit('fixture.tsx', (s) =>
  s.replace("applyTheme('Macro Dark');", "applyTheme('Macro Dark');\n(window as any).__applyTheme = applyTheme;")
);
for (const [rel, fn] of Object.entries(scenes.patches || {})) edit(rel, fn);
// The website keeps one name out of its demos: that person becomes Peter,
// with his cast photo from the website.
fs.copyFileSync(path.join(here, '../src/assets/people/peter.jpeg'), `${dest}/people/peter.jpeg`);
fs.rmSync(`${dest}/people/valentina.webp`, { force: true });
rewrite((t) =>
  t
    .replaceAll('valentina.webp', 'peter.jpeg')
    .replaceAll('valentina@macro.com', 'peter@macro.com')
    .replaceAll('Valentina', 'Peter')
    .replaceAll('valentina', 'peter')
);

const port = Number(process.env.PORT || 5560);
const vite = spawn(process.execPath, [`${MACRO}/node_modules/vite/bin/vite.js`, '--config', `${dest}/vite.config.ts`, '--port', String(port), '--strictPort'], {
  cwd: dest,
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Never leave Vite running: a later run on this port would talk to it.
process.on('exit', () => vite.kill());
let log = '';
vite.stdout.on('data', (d) => (log += d));
vite.stderr.on('data', (d) => (log += d));
const base = `http://127.0.0.1:${port}/`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(base)).ok) break;
  } catch {}
  if (i > 240) {
    console.log(log);
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 250));
}

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
fs.mkdirSync(OUT, { recursive: true });
const theme = async (page, id) => {
  await page.evaluate((t) => {
    if (!window.__applyTheme) throw new Error('the set did not render (no theme switch)');
    window.__applyTheme(t);
  }, id);
  await page.waitForTimeout(700);
};

for (const shot of scenes.shots) {
  if (only && !only.split(',').includes(shot.name)) continue;
  try {
    await take(shot);
  } catch (e) {
    console.log(shot.name, 'FAILED', String(e).slice(0, 400));
  }
}

async function take(shot) {
  const phone = Boolean(shot.phone);
  const ctx = await browser.newContext(
    phone
      ? { viewport: { width: 390, height: 770 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: shot.viewport || { width: 1000, height: 600 }, deviceScaleFactor: 2 }
  );
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
  await page.clock.install({ time: new Date(scenes.clock || CLOCK) });
  await page.addInitScript(() => performance.setResourceTimingBufferSize(100000));
  if (phone) {
    await page.addInitScript(() => {
      const mm = window.matchMedia.bind(window);
      window.matchMedia = (q) =>
        q.includes('pointer: coarse') ? { ...mm(q), matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm(q);
    });
  }
  await page.goto(`${base}?${shot.q || ''}`, { timeout: 300000 });
  await page.waitForTimeout(shot.wait ?? 5000);
  try {
    if (shot.act) await shot.act(page);
  } catch (e) {
    errors.push(`act: ${String(e).slice(0, 400)}`);
  }

  if (shot.dump) console.log(shot.name, 'dump', await page.evaluate(shot.dump));
  const stem = `${OUT}/${set}-${shot.name}`;
  const capture = async (file) => {
    if (shot.selector) await page.locator(shot.selector).first().screenshot({ path: file });
    else await page.screenshot({ path: file, ...(shot.clip ? { clip: shot.clip } : {}) });
  };
  // Where the capture starts in the page, for focus rectangles given in capture pixels.
  let origin = { x: 0, y: 0 };
  if (shot.selector) {
    const box = await page.locator(shot.selector).first().boundingBox();
    origin = { x: box.x, y: box.y };
  } else if (shot.clip) origin = { x: shot.clip.x, y: shot.clip.y };
  // Mark the element under the focus now, while the layout matches the capture.
  const err = shot.focus
    ? await page.evaluate(
        (f) => {
          let best = null;
          let score = Infinity;
          for (const e of document.querySelectorAll('body *')) {
            const r = e.getBoundingClientRect();
            if (!r.width || !r.height) continue;
            const d = Math.abs(r.x - f.x) + Math.abs(r.y - f.y) + Math.abs(r.right - f.x - f.w) + Math.abs(r.bottom - f.y - f.h);
            if (d < score) {
              score = d;
              best = e;
            }
          }
          best?.setAttribute('data-narrow-focus', '');
          return score;
        },
        { x: shot.focus.x + origin.x, y: shot.focus.y + origin.y, w: shot.focus.width, h: shot.focus.height }
      )
    : null;

  await capture(`${stem}-dark.png`);
  await theme(page, 'Macro Light');
  await capture(`${stem}-light.png`);

  if (shot.focus) {
    await theme(page, 'Macro Dark');
    await page.setViewportSize(NARROW);
    await page.mouse.move(-20, -20);
    await page.waitForTimeout(1800);
    const rect = await page.evaluate(() => {
      const e = document.querySelector('[data-narrow-focus]');
      if (!e) return null;
      let r = e.getBoundingClientRect();
      if (r.top < 0 || r.bottom > innerHeight) {
        e.scrollIntoView({ block: 'center' });
        r = e.getBoundingClientRect();
      }
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(Math.min(innerWidth, r.right) - x),
        height: Math.round(Math.min(innerHeight, r.bottom) - y),
      };
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${stem}-narrow-dark.png` });
    await theme(page, 'Macro Light');
    await page.screenshot({ path: `${stem}-narrow-light.png` });
    console.log('NARROW', JSON.stringify({ shot: shot.name, err, rect }));
  }
  console.log(shot.name, 'captured', [...new Set(errors)].slice(0, 4).join(' | '));
  await ctx.close();
}

const viteErrors = log.split('\n').filter((l) => /Unhandled error|Failed to resolve|Internal server error/.test(l));
if (viteErrors.length) console.log('vite:', [...new Set(viteErrors.map((l) => l.slice(0, 260)))].slice(0, 8).join('\n'));
await browser.close();
vite.kill();
process.exit(0);
