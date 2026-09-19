import assert from 'node:assert/strict';
import type { Browser } from 'webdriverio';
import { fixtureId, USER_ID } from './fixtures/mail';

/** Read-only native-cache diagnostics; never seed the cache or replace IPC. */
export async function invokeNative(
  browser: Browser,
  command: string,
  args: Record<string, unknown>
) {
  return browser.execute(
    async (command, args) => {
      const tauri = (
        window as unknown as {
          __TAURI_INTERNALS__?: {
            invoke: (
              command: string,
              args: Record<string, unknown>
            ) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__;
      if (!tauri) throw new Error('Not a native Tauri webview');
      return await tauri.invoke(command, args);
    },
    command,
    args
  );
}

export async function checkpoints(browser: Browser) {
  return browser.execute(
    (userId) =>
      Object.keys(localStorage)
        .filter(
          (key) =>
            key.startsWith('graphql-soup-backfill:') && key.includes(userId)
        )
        .map((key) => ({
          key,
          ...(JSON.parse(localStorage.getItem(key) ?? '{}') as {
            completed: boolean;
            pagesFetched: number;
          }),
        })),
    USER_ID
  );
}

export async function waitForBackfill(browser: Browser, pages = 3) {
  await browser.waitUntil(
    async () =>
      (await checkpoints(browser)).some(
        (checkpoint) =>
          checkpoint.key.endsWith(':email-filter-metadata') &&
          checkpoint.completed &&
          checkpoint.pagesFetched === pages
      ),
    {
      timeout: 120_000,
      timeoutMsg: `Real metadata backfill did not checkpoint all ${pages} pages`,
    }
  );
}

export async function assertNativeRecords(browser: Browser) {
  const result = (await invokeNative(
    browser,
    'graphql_cache_read_records_by_keys',
    {
      document:
        'fragment NativeE2ERecord on GraphqlSoupEmailThread { id name isRead inboxVisible }',
      fragmentName: 'NativeE2ERecord',
      keys: [4, 6, 8, 9, 10, 12].map(
        (n) => `GraphqlSoupEmailThread:${fixtureId(n)}`
      ),
    }
  )) as { records: { recordKey: string; record: { id: string } | null }[] };
  assert.equal(result.records.length, 6);
  assert.deepEqual(
    result.records.map((record) => record.record?.id).sort(),
    [4, 6, 8, 9, 10, 12].map(fixtureId).sort()
  );
}

/** Assert exact row identities rather than counts or cached labels alone. */
export async function expectRows(browser: Browser, numbers: number[]) {
  const expected = numbers.map(fixtureId).sort();
  await browser.waitUntil(
    async () => {
      const actual = await browser.execute(() =>
        [...document.querySelectorAll('[data-entity-id]')]
          .map((element) => element.getAttribute('data-entity-id'))
          .filter(
            (id): id is string =>
              id?.startsWith('00000000-0000-0000-0000-') ?? false
          )
      );
      return (
        JSON.stringify([...new Set(actual)].sort()) === JSON.stringify(expected)
      );
    },
    {
      timeout: 15_000,
      timeoutMsg: `Expected visible mail rows ${numbers.join(', ')} from the native cache.`,
    }
  );
}

/** Exercise the same native HTTP transport as the app, not the runner's fetch. */
export async function nativeHttpReachable(browser: Browser, origin: string) {
  return browser.execute(async (origin) => {
    const modulePath = '/src/lib/core/util/platformFetch.ts';
    const { platformFetch }: { platformFetch: typeof fetch } = await import(
      modulePath
    );
    try {
      return (
        await platformFetch(`${origin}/health`, {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, origin);
}

export async function selectTab(browser: Browser, label: 'Noise' | 'All') {
  const tab = browser.$(
    `//nav[@aria-label="Email tabs"]//button[.//span[normalize-space(.)="${label}"]]`
  );
  // Public Email tab hotkeys (see useViewTabHotkeys/EMAIL_TABS). Keep focus
  // in the list; Enter would activate an email rather than the sidebar tab.
  await browser.keys(label === 'Noise' ? '2' : '7');
  await browser.waitUntil(
    async () => (await tab.getAttribute('aria-current')) === 'page',
    {
      timeout: 5000,
      timeoutMsg: `${label} tab did not become selected`,
    }
  );
}
