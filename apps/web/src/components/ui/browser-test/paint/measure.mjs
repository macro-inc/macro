import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';

const directory = process.env.PAINT_OUTPUT ?? '/tmp/runtime-overhead/paint-baseline';
const origin = process.env.PAINT_ORIGIN ?? 'http://127.0.0.1:3019';
const duration = Number(process.env.PAINT_DURATION ?? 3000);
await mkdir(directory, { recursive: true });
const results = [];
for (const mode of ['default', 'software']) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    args: ['--no-sandbox', ...(mode === 'software' ? ['--disable-gpu'] : [])],
  });
  const browserSession = await browser.newBrowserCDPSession();
  const system = await browserSession.send('SystemInfo.getInfo');
  await writeFile(`${directory}/${mode}-gpu.json`, JSON.stringify(system.gpu, null, 2));
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  // Measurement control only: replay pre-lifecycle timing over the same real
  // components and stylesheet. No production flag or alternate render path.
  if (process.env.PAINT_VISIBILITY === 'unmanaged') {
    await page.route('**/animationVisibility.ts*', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'export function pauseOffscreenAnimations() {}',
    }));
  }
  page.setDefaultTimeout(90000);
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await session.send('Performance.enable');
  const cases = [
    { kind: 'surfaces' }, { kind: 'surfaces', touch: true },
    { kind: 'surfaces', scroll: true }, { kind: 'surfaces', dialog: true },
    { kind: 'shimmer' }, { kind: 'shimmer', offscreen: true },
    { kind: 'skeleton' }, { kind: 'skeleton', offscreen: true },
    { kind: 'agents' }, { kind: 'agents', offscreen: true },
    { kind: 'working', offscreen: true }, { kind: 'loader' }, { kind: 'loader', offscreen: true },
  ];
  for (const options of cases) {
    const name = Object.entries(options).map(([key, value]) => key === 'kind' ? value : key).join('-');
    const query = new URLSearchParams({ kind: options.kind, count: '40', theme: 'dark' });
    if (options.offscreen) query.set('offscreen', 'true');
    if (options.touch) query.set('touch', 'true');
    await page.goto(`${origin}/?${query}`);
    await page.locator('[data-samples]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    if (options.dialog) await page.getByRole('button', { name: 'Open dialog' }).click();
    await page.waitForTimeout(500);
    const events = [];
    const collect = (data) => events.push(...data.value);
    session.on('Tracing.dataCollected', collect);
    await session.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,cc,gpu,disabled-by-default-gpu.service,blink.user_timing',
      transferMode: 'ReportEvents',
    });
    const before = await session.send('Performance.getMetrics');
    const cpuBefore = await browserSession.send('SystemInfo.getProcessInfo');
    const start = Date.now();
    if (options.scroll) {
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(0, i < 5 ? 160 : -120);
        await page.waitForTimeout(duration / 10);
      }
    } else await page.waitForTimeout(duration);
    const elapsed = Date.now() - start;
    if (options.scroll && await page.locator('[data-scroll]').evaluate((element) => element.scrollTop) < 1) throw new Error('Scroll fixture did not scroll');
    const after = await session.send('Performance.getMetrics');
    const cpuAfter = await browserSession.send('SystemInfo.getProcessInfo');
    const cpu = {};
    for (const process of cpuAfter.processInfo) {
      const previous = cpuBefore.processInfo.find((entry) => entry.id === process.id);
      if (previous) cpu[process.type] = (cpu[process.type] ?? 0) + (process.cpuTime - previous.cpuTime) * 100000 / elapsed;
    }
    const complete = once(session, 'Tracing.tracingComplete');
    await session.send('Tracing.end');
    await complete;
    session.off('Tracing.dataCollected', collect);
    const metrics = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map((key) => [key, after.metrics.find((metric) => metric.name === key).value - before.metrics.find((metric) => metric.name === key).value]));
    const eventNames = ['Paint', 'CompositeLayers', 'RasterTask', 'GPUTask', 'DrawFrame', 'ProxyImpl::ScheduledActionDraw', 'DrawLayers.FrameViewerTracing', 'MainFrame.Draw', 'UpdateLayoutTree', 'LayerTreeHostImpl::DrawLayers', 'Display::DrawAndSwap', 'TimerFire', 'FireAnimationFrame', 'FunctionCall'];
    const timing = Object.fromEntries(eventNames.map((name) => {
      const matching = events.filter((event) => event.name === name);
      return [name, { count: matching.length, ms: matching.reduce((sum, event) => sum + (event.dur ?? 0), 0) / 1000 }];
    }));
    const animations = await page.evaluate(() => document.getAnimations().reduce((counts, animation) => { counts[animation.playState] = (counts[animation.playState] ?? 0) + 1; return counts; }, {}));
    const result = { mode, name, elapsed, metrics, cpu, timing, animations };
    results.push(result);
    await writeFile(`${directory}/${mode}-${name}.trace.json`, JSON.stringify({ traceEvents: events }));
    await writeFile(`${directory}/results.json`, JSON.stringify(results, null, 2));
    console.log(mode, name, JSON.stringify({ mainThreadBusyPercent: metrics.TaskDuration * 100000 / elapsed, cpu, timing, animations }));
  }
  // Freeze all animations at the same phase for reproducible appearance checks.
  for (const theme of ['light', 'dark']) for (const kind of ['surfaces', 'shimmer', 'skeleton', 'agents', 'working', 'loader']) {
    await page.goto(`${origin}/?kind=${kind}&count=12&theme=${theme}`);
    await page.locator('[data-samples]').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); if (animation.animationName === 'magic-chip-shimmer') animation.effect.updateTiming({ delay: 0 }); animation.currentTime = 900; }));
    await page.evaluate(() => document.querySelectorAll('svg').forEach((svg) => { svg.pauseAnimations(); svg.setCurrentTime(0.9); }));
    await page.screenshot({ path: `${directory}/${mode}-${kind}-${theme}.png` });
    if (kind === 'surfaces') {
      await page.getByRole('button', { name: 'Open dialog' }).click();
      await page.waitForTimeout(300);
      await page.evaluate(() => document.getAnimations().forEach((animation) => { animation.pause(); if (animation.animationName === 'magic-chip-shimmer') animation.effect.updateTiming({ delay: 0 }); animation.currentTime = 900; }));
      await page.screenshot({ path: `${directory}/${mode}-dialog-${theme}.png` });
    }
  }
  await browser.close();
}
