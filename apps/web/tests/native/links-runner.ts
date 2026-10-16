import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, remote } from 'webdriverio';
import type {} from './fixtures/links-browser';

assert.equal(process.env.MACRO_E2E_NETNS, '1', 'Run through isolated run.sh');
const web = resolve(import.meta.dirname, '../..');
const binaries = resolve(web, 'tauri/target/e2e');
const artifacts = resolve(
  web,
  'test-results/native',
  `links-${new Date().toISOString().replaceAll(':', '-')}`
);
const launcherDirectory = resolve(artifacts, 'bin');
await mkdir(launcherDirectory, { recursive: true });
const launchLog = resolve(artifacts, 'opened-urls.txt');
await Bun.write(launchLog, '');
// Exercise the real opener/OS process boundary without launching a browser or
// sending requests outside the isolated network namespace.
await writeFile(
  resolve(launcherDirectory, 'xdg-open'),
  '#!/bin/sh\nprintf "%s\\n" "$1" >> "$MACRO_LINK_TEST_LOG"\n',
  { mode: 0o755 }
);
const bundle = await Bun.build({
  entrypoints: [resolve(import.meta.dirname, 'fixtures/links-browser.ts')],
  target: 'browser',
});
assert(bundle.success, String(bundle.logs));
const javascript = await bundle.outputs[0].text();
const html = await Bun.file(
  resolve(import.meta.dirname, 'fixtures/links.html')
).text();
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 3009,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === '/billing-lab.html') {
      return new Response(
        '<!doctype html><title>Standalone HTML document</title><h1>Standalone document</h1>',
        {
          headers: { 'Content-Type': 'text/html' },
        }
      );
    }
    const script = path === '/links.js';
    return new Response(script ? javascript : html, {
      headers: { 'Content-Type': script ? 'text/javascript' : 'text/html' },
    });
  },
});
const driver = Bun.spawn(
  [
    resolve(binaries, 'tools/bin/tauri-driver'),
    '--port',
    '4444',
    '--native-driver',
    Bun.which('WebKitWebDriver')!,
  ],
  {
    env: {
      ...process.env,
      PATH: `${launcherDirectory}:${process.env.PATH}`,
      MACRO_LINK_TEST_LOG: launchLog,
      WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: '1',
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
    },
    stdout: Bun.file(resolve(artifacts, 'tauri.log')),
    stderr: Bun.file(resolve(artifacts, 'tauri.stderr.log')),
  }
);
const watchdog = setTimeout(() => {
  console.error(`Native link tests timed out. Artifacts: ${artifacts}`);
  process.exit(1);
}, 120_000);
let browser: Browser | undefined;
const expected: string[] = [];
const openedUrls = async () =>
  (await Bun.file(launchLog).text()).split('\n').filter(Boolean);

try {
  for (;;) {
    assert.equal(driver.exitCode, null, 'Driver exited before ready');
    try {
      if ((await fetch('http://localhost:4444/status')).ok) break;
    } catch {
      // Wait for WebKitWebDriver to bind.
    }
    await Bun.sleep(100);
  }
  const capabilities: WebdriverIO.Capabilities & {
    'tauri:options': { application: string };
  } = { 'tauri:options': { application: resolve(binaries, 'app') } };
  browser = await remote({
    hostname: '127.0.0.1',
    port: 4444,
    logLevel: 'warn',
    connectionRetryCount: 0,
    connectionRetryTimeout: 30_000,
    capabilities,
  });
  await browser.waitUntil(
    () =>
      browser!.execute(() => document.documentElement.dataset.ready === 'true'),
    { timeout: 30_000 }
  );
  const originalUrl = await browser.getUrl();
  async function expectOpened(url: string) {
    expected.push(url);
    await browser!.waitUntil(
      async () => (await openedUrls()).length >= expected.length
    );
    assert.deepEqual(
      await openedUrls(),
      expected,
      'Each activation must open exactly once'
    );
    assert.equal(
      await browser!.getUrl(),
      originalUrl,
      'External URL replaced the app'
    );
    assert.equal(
      (await browser!.getWindowHandles()).length,
      1,
      'Unexpected popup webview'
    );
  }

  await browser.$('#stopped-link').click();
  await expectOpened('https://github.com/macro-inc/macro/pull/7858');
  await browser.keys('Enter');
  await expectOpened('https://github.com/macro-inc/macro/pull/7858');
  assert.deepEqual(
    await browser.execute(() => window.linkFixture.windowClicks),
    []
  );

  await browser.$('#plain-link').click();
  await expectOpened('https://example.com/plain');
  assert.equal(
    await browser.execute(() => window.linkFixture.windowClicks.at(-1)),
    false,
    'Desktop must not install the JS click interceptor'
  );
  await browser.$('#self-link').click();
  await expectOpened('https://example.com/self');
  await browser.$('#popup').click();
  await expectOpened('https://example.com/programmatic');

  // WebKitWebDriver can miss short text links with pointer coordinates. The
  // original PR link above covers pointer activation; use real keyboard
  // activation for the remaining links, not a synthetic navigation callback.
  async function activate(id: string) {
    await browser!.$(`#${id}`).execute((element) => element.focus());
    await browser!.keys('Enter');
    assert.equal(
      await browser!.execute(() => window.linkFixture.clickTargets.at(-1)),
      id
    );
  }
  for (const id of ['app-link', 'relative-link']) {
    await activate(id);
    const count = id === 'app-link' ? 1 : 2;
    await browser.waitUntil(
      () =>
        browser!.execute(
          (count) => window.linkFixture.events.length >= count,
          count
        ),
      { timeoutMsg: `No native navigation event for ${id}` }
    );
    assert.deepEqual(
      await browser.execute(() => window.linkFixture.events),
      Array.from({ length: count }, () => ({
        path: '/mail',
        query: 'view=all',
      }))
    );
  }
  await activate('prevented-link');
  for (const url of [
    'about:blank',
    'data:text/html,blocked',
    'file:///etc/passwd',
  ]) {
    await browser.execute((url) => {
      window.linkFixture.popupUrl = url;
    }, url);
    await activate('popup');
  }
  await Bun.sleep(500);
  assert.deepEqual(await openedUrls(), expected);
  assert.equal(await browser.getUrl(), originalUrl);
  assert.equal((await browser.getWindowHandles()).length, 1);
  const originalWindow = await browser.getWindowHandle();
  await activate('standalone-link');
  await browser.waitUntil(
    async () => (await browser!.getWindowHandles()).length === 2,
    {
      timeoutMsg: 'Standalone HTML document did not open a native popup',
    }
  );
  const popup = (await browser.getWindowHandles()).find(
    (handle) => handle !== originalWindow
  )!;
  await browser.switchToWindow(popup);
  await browser.waitUntil(
    async () => (await browser!.getTitle()) === 'Standalone HTML document'
  );
  assert.equal(
    await browser.getUrl(),
    'http://localhost:3009/billing-lab.html'
  );
  await browser.closeWindow();
  await browser.switchToWindow(originalWindow);
  assert.equal(await browser.getUrl(), originalUrl);
  assert.deepEqual(await openedUrls(), expected);
  assert.equal(
    await browser.execute(() => window.linkFixture.events.length),
    2
  );
  await browser.saveScreenshot(resolve(artifacts, 'links.png'));
  console.log(
    'PASS: native popup and same-frame routing, stopped clicks, keyboard, cancellation, no duplicates, in-app links, and standalone HTML documents'
  );
} catch (error) {
  if (browser) {
    try {
      await Bun.write(
        resolve(artifacts, 'failure-state.json'),
        JSON.stringify(
          await browser.execute(() => ({
            fixture: window.linkFixture,
            url: location.href,
            focusedElement: document.activeElement?.id,
          })),
          null,
          2
        )
      );
      await browser.saveScreenshot(resolve(artifacts, 'failure.png'));
      await Bun.write(
        resolve(artifacts, 'failure.html'),
        await browser.getPageSource()
      );
    } catch {
      // A crashed webview may not be available for diagnostics.
    }
  }
  throw error;
} finally {
  if (browser) {
    try {
      await browser.deleteSession();
    } catch {
      // Driver cleanup below still owns processes if the webview crashed.
    }
  }
  driver.kill();
  await Promise.race([driver.exited, Bun.sleep(2000)]);
  if (driver.exitCode === null) driver.kill('SIGKILL');
  await server.stop(true);
  clearTimeout(watchdog);
  console.log(`Artifacts: ${artifacts}`);
}
