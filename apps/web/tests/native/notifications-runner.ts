import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, remote } from 'webdriverio';
import type {} from './fixtures/notifications-browser';

assert.equal(process.env.MACRO_E2E_NETNS, '1', 'Run through isolated run.sh');
const web = resolve(import.meta.dirname, '../..');
const binaries = resolve(web, 'tauri/target/e2e');
const artifacts = resolve(
  web,
  'test-results/native',
  `notifications-${Date.now()}`
);
await mkdir(artifacts, { recursive: true });
const bundle = await Bun.build({
  entrypoints: [
    resolve(import.meta.dirname, 'fixtures/notifications-browser.ts'),
  ],
  target: 'browser',
});
assert(bundle.success, String(bundle.logs));
const javascript = await bundle.outputs[0].text();
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 3009,
  fetch(request) {
    if (new URL(request.url).pathname === '/notifications.js') {
      return new Response(javascript, {
        headers: { 'Content-Type': 'text/javascript' },
      });
    }
    return new Response(
      '<!doctype html><title>Notifications</title><h1>Native notification regression</h1><script type="module" src="/notifications.js"></script>',
      {
        headers: { 'Content-Type': 'text/html' },
      }
    );
  },
});
const daemon = Bun.spawn(
  [resolve(binaries, 'cargo/debug/examples/notification-test-daemon')],
  {
    stdout: Bun.file(resolve(artifacts, 'daemon.log')),
    stderr: Bun.file(resolve(artifacts, 'daemon.stderr.log')),
  }
);
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
      WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: '1',
      WEBKIT_DISABLE_DMABUF_RENDERER: '1',
      LIBGL_ALWAYS_SOFTWARE: '1',
    },
    stdout: Bun.file(resolve(artifacts, 'tauri.log')),
    stderr: Bun.file(resolve(artifacts, 'tauri.stderr.log')),
  }
);
const watchdog = setTimeout(() => {
  console.error(`Notification test timed out: ${artifacts}`);
  process.exit(1);
}, 120_000);
let browser: Browser | undefined;
async function call(method: string, id?: number) {
  const process = Bun.spawn(
    [
      'gdbus',
      'call',
      '--session',
      '--dest',
      'org.freedesktop.Notifications',
      '--object-path',
      '/org/freedesktop/Notifications',
      '--method',
      `org.freedesktop.Notifications.${method}`,
      ...(id === undefined ? [] : [String(id)]),
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  );
  const output = await new Response(process.stdout).text();
  assert.equal(
    await process.exited,
    0,
    await new Response(process.stderr).text()
  );
  return output;
}
try {
  for (;;) {
    assert.equal(driver.exitCode, null);
    assert.equal(daemon.exitCode, null);
    try {
      if (
        (await fetch('http://localhost:4444/status')).ok &&
        (await Bun.file(resolve(artifacts, 'daemon.log')).text()).includes(
          'ready'
        )
      )
        break;
    } catch {
      /* Wait for both services. */
    }
    await Bun.sleep(100);
  }
  const capabilities: WebdriverIO.Capabilities & {
    'tauri:options': { application: string };
  } = {
    'tauri:options': { application: resolve(binaries, 'app') },
  };
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
  await browser.execute(async () => {
    await window.notificationFixture.show();
    await window.notificationFixture.show();
  });
  await call('Activate', 2);
  await browser.waitUntil(() =>
    browser!.execute(() => window.notificationFixture.clicked.length === 1)
  );
  assert.deepEqual(
    await browser.execute(() => window.notificationFixture.clicked),
    [1]
  );
  assert.equal(await browser.execute(() => location.hash), '#notification-1');
  await call('Dismiss', 1);
  await browser.waitUntil(() =>
    browser!.execute(() => window.notificationFixture.dismissed.length === 1)
  );
  assert.deepEqual(
    await browser.execute(() => window.notificationFixture.dismissed),
    [0]
  );
  await browser.execute(async () => {
    await window.notificationFixture.show();
    window.notificationFixture.close(2);
  });
  await browser.waitUntil(() =>
    browser!.execute(() => window.notificationFixture.dismissed.length === 2)
  );
  const snapshot = await call('Snapshot');
  assert.match(snapshot, /"closed":\[2,3\]/);
  assert.match(snapshot, /"sent":3/);
  assert.match(
    snapshot,
    /"connections":1/,
    'All sends must reuse one session-bus connection'
  );
  assert.deepEqual(
    await browser.execute(() => window.notificationFixture.clicked),
    [1]
  );
  for (const log of ['tauri.log', 'tauri.stderr.log']) {
    assert.doesNotMatch(
      await Bun.file(resolve(artifacts, log)).text(),
      /Unable to close Linux notification/,
      'A notification already removed by the daemon must not warn'
    );
  }
  await browser.saveScreenshot(resolve(artifacts, 'notifications.png'));
  console.log(
    'PASS: real Linux WebKit -> native D-Bus delivery -> GTK activation -> correct JS callback; dismissal, explicit close, and already-removed cleanup without warnings'
  );
} finally {
  if (browser) {
    try {
      await browser.deleteSession();
    } catch {
      /* Shutdown still owns the driver. */
    }
  }
  driver.kill();
  daemon.kill();
  await Promise.race([
    Promise.all([driver.exited, daemon.exited]),
    Bun.sleep(2000),
  ]);
  if (driver.exitCode === null) driver.kill('SIGKILL');
  if (daemon.exitCode === null) daemon.kill('SIGKILL');
  await server.stop(true);
  clearTimeout(watchdog);
  console.log(`Artifacts: ${artifacts}`);
}
