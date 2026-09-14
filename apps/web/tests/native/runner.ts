import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { type Browser, remote } from 'webdriverio';
import {
  assertNativeRecords,
  checkpoints,
  expectRows,
  nativeHttpReachable,
  selectTab,
  waitForBackfill,
} from './driver';
import { startFixtureServer } from './fixtures/server';

assert.equal(process.platform, 'linux', 'Linux is the initial driver target');
assert.equal(
  process.env.MACRO_E2E_NETNS,
  '1',
  'Use run.sh: native tests must have network isolation'
);
assert(
  process.argv.slice(2).every((arg) => arg === '--smoke'),
  'Usage: native:e2e [--smoke]'
);
const smokeOnly = process.argv.includes('--smoke');
const web = resolve(import.meta.dirname, '../..');
const binaries = resolve(web, 'tauri/target/e2e');
const artifacts = resolve(
  web,
  'test-results/native',
  new Date().toISOString().replaceAll(':', '-')
);
await mkdir(artifacts, { recursive: true });
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^(VITE_|LOCAL_JWT$|MODE$|PORT$|TAURI_|https?_proxy$|all_proxy$|no_proxy$)/i.test(
          key
        )
    )
  ),
  // This app is root only within the unprivileged, loopback-only user namespace.
  WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: '1',
  WEBKIT_DISABLE_DMABUF_RENDERER: '1',
  LIBGL_ALWAYS_SOFTWARE: '1',
};
const children: ReturnType<typeof Bun.spawn>[] = [];
let browser: Browser | undefined;
const fixture = startFixtureServer(18090);
// Bound even a wedged WebDriver request or shutdown. The shell owns namespace
// and profile cleanup, so forced exit cannot leave an app or fixture listening.
const watchdog = setTimeout(() => {
  writeFileSync(
    resolve(artifacts, 'requests.json'),
    JSON.stringify(fixture.requests, null, 2)
  );
  console.error(`E2E timed out after four minutes. Artifacts: ${artifacts}`);
  process.exit(1);
}, 240_000);

function spawn(name: string, cmd: string[], extraEnv = {}) {
  const child = Bun.spawn(cmd, {
    cwd: web,
    env: { ...env, ...extraEnv },
    stdout: Bun.file(resolve(artifacts, `${name}.log`)),
    stderr: Bun.file(resolve(artifacts, `${name}.stderr.log`)),
  });
  children.push(child);
  return child;
}

async function ready(url: string, child: ReturnType<typeof Bun.spawn>) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(`Process exited before ready: ${url}. See ${artifacts}`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* listener not yet bound */
    }
    await Bun.sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function capture(prefix = 'webview') {
  await Bun.write(
    resolve(artifacts, 'requests.json'),
    JSON.stringify(fixture.requests, null, 2)
  );
  if (!browser) return;
  try {
    await browser.saveScreenshot(resolve(artifacts, `${prefix}.png`));
    await Bun.write(
      resolve(artifacts, `${prefix}.html`),
      await browser.getPageSource()
    );
    await Bun.write(
      resolve(artifacts, 'checkpoints.json'),
      JSON.stringify(await checkpoints(browser), null, 2)
    );
  } catch (error) {
    console.error('Could not capture webview diagnostics:', error);
  }
}

try {
  const vite = spawn(
    'vite',
    [
      'bun',
      'x',
      '--no-install',
      'vite',
      '--config',
      'tests/native/vite.config.ts',
    ],
    {
      MODE: 'development',
      PORT: '3009',
      VITE_LOCAL_SERVERS: 'ALL',
      VITE_LOCAL_BACKEND_ORIGIN: fixture.origin,
      VITE_ENABLE_BEARER_TOKEN_AUTH: 'true',
      LOCAL_JWT: 'fixture-only',
      VITE_ENABLE_GRAPHQL_SOUP: 'true',
      VITE_ENABLE_GRAPHQL_BACKFILL: 'true',
      VITE_ENABLE_NEW_APP_VIEWS: 'true',
      VITE_ENABLE_AUTO_UPDATE_UI: 'false',
    }
  );
  await ready('http://localhost:3009/app/component/mail', vite);
  const driver = spawn('tauri', [
    resolve(binaries, 'tools/bin/tauri-driver'),
    '--port',
    '4444',
    '--native-driver',
    Bun.which('WebKitWebDriver')!,
  ]);
  await ready('http://localhost:4444/status', driver);
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
    connectionRetryTimeout: 120_000,
    capabilities,
  });
  console.log(`Native session ${browser.sessionId}; opening Email`);
  const emailNavigation = browser.$('button[aria-label="Go to Email"]');
  await emailNavigation.waitForDisplayed({ timeout: 120_000 });
  await emailNavigation.click();
  console.log('Waiting for three metadata backfill pages');
  await waitForBackfill(browser);
  assert.equal(fixture.metadataPagesServed, 3);
  assert.deepEqual(
    fixture.requests.filter((request) => request.error),
    []
  );
  await assertNativeRecords(browser);
  const cacheFile = resolve(
    process.env.XDG_DATA_HOME!,
    'com.macro.app.e2e/graphql-cache/cache.turso'
  );
  assert(
    (await stat(cacheFile)).size > 0,
    'Expected the isolated native Turso database'
  );
  await expectRows(browser, [6, 12]);
  const onlineSoupRequests = fixture.requests.filter(
    (request) =>
      request.operation === 'Soup' &&
      JSON.stringify(request.variables).includes('"emailView":"INBOX"')
  );
  assert(
    onlineSoupRequests.length > 0,
    'Initial Signal baseline must come from the API'
  );
  console.log(
    'PASS: real UI, three backfill pages, and all six records in the native cache'
  );

  assert.equal(await nativeHttpReachable(browser, fixture.origin), true);
  assert(
    fixture.socketCount > 0,
    'Realtime transports must connect before the outage'
  );
  await fixture.disconnect();
  assert.equal(fixture.socketCount, 0);
  assert.equal(await nativeHttpReachable(browser, fixture.origin), false);
  await assert.rejects(
    fetch(`${fixture.origin}/health`, { signal: AbortSignal.timeout(1000) })
  );
  // Native storage still works with the API listener gone.
  await assertNativeRecords(browser);
  if (!smokeOnly) {
    const requestsAtDisconnect = fixture.requests.length;
    // None of these views were fetched online: their rows must be selected
    // from backfilled normalized records, not replayed query-response caches.
    const failures: unknown[] = [];
    const cases = [
      {
        name: 'noise',
        select: () => selectTab(browser!, 'Noise'),
        rows: [4, 8, 10],
      },
      {
        name: 'all',
        select: () => selectTab(browser!, 'All'),
        rows: [4, 6, 8, 9, 10, 12],
      },
    ];
    for (const scenario of cases) {
      await scenario.select();
      try {
        await expectRows(browser, scenario.rows);
        console.log(`PASS: offline ${scenario.name}`);
      } catch (error) {
        failures.push(error);
        console.error(`FAIL: offline ${scenario.name}`);
        await capture(scenario.name);
      }
    }
    assert.equal(fixture.requests.length, requestsAtDisconnect);
    if (failures.length)
      throw new AggregateError(failures, 'Native offline filter regressions');
    console.log('PASS: unseen email filter combinations evaluated offline');
  } else {
    console.log(
      'PASS: disconnected API with native cache reads (filter regression not run)'
    );
  }
} catch (error) {
  process.exitCode = 1;
  console.error(error);
} finally {
  await capture();
  if (browser) {
    try {
      await browser.deleteSession();
    } catch {
      /* driver may have already exited */
    }
  }
  await fixture.disconnect();
  for (const child of children.reverse()) {
    child.kill();
    await Promise.race([child.exited, Bun.sleep(3000)]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await child.exited;
    }
  }
  clearTimeout(watchdog);
  console.log(`Artifacts: ${artifacts}`);
}
