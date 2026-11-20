// The local stack, as the differential drivers reach it: SQL against its
// Postgres, its Redis sign-up counter, and signed-in pages that load the
// harness from its Vite dev server.
import { execFileSync } from 'node:child_process';
import type { BrowserContext, Page } from 'playwright';

const env = process.env;
export const ORIGIN = env.PX_ORIGIN ?? 'https://localhost:20609';
export const PG = env.PX_PG ?? 'macro-gqlpart-postgres-1';
export const HARNESS = '/src/__proof__/participants/harness.tsx';

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function sql(query: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      PG,
      'psql',
      '-U',
      'user',
      '-d',
      'macrodb',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    {
      input: query,
      maxBuffer: 1 << 28,
    }
  )
    .toString()
    .trim();
}

export const lit = (value: string) => `'${value.replaceAll("'", "''")}'`;

// The auth service lets one address sign up 50 users an hour and counts them
// in Redis under this key (crates/macro_cache_client/src/create_user_rate_limit.rs);
// every user here signs up from this machine, so the counter in this
// instance's own Redis is cleared first, as tests/email-e2e does.
const REDIS = env.PX_REDIS ?? PG.replace(/postgres-1$/, 'redis-1');
export function clearSignUpCounter() {
  const keys = execFileSync('docker', [
    'exec',
    REDIS,
    'redis-cli',
    '--scan',
    '--pattern',
    'rtl_create_user_hourly:*',
  ])
    .toString()
    .split('\n')
    .filter(Boolean);
  if (keys.length)
    execFileSync('docker', ['exec', REDIS, 'redis-cli', 'DEL', ...keys]);
}

/**
 * Harness calls a lost one of which can be made again: they change nothing, or
 * (mount) start by undoing what they did before.
 */
const REPEATABLE = new Set([
  'install',
  'mount',
  'snapshot',
  'settle',
  'unmount',
  'setMutant',
]);
/** How many harness calls were lost and made again, by method (see px). */
export const lostCalls: Record<string, number> = {};
/** Harness calls that had not answered after PX_CALL_TIMEOUT_MS, by method. */
export const hungCalls: Record<string, number> = {};
const CALL_TIMEOUT_MS = Number(process.env.PX_CALL_TIMEOUT_MS ?? 180_000);

/**
 * Calls `window.__px[method]` in the page, loading the harness first. Chromium
 * now and then drops an evaluation ("Resulting promise was garbage collected")
 * with the page still there: a call that changes nothing is made again and
 * counted; any other fails with its method named.
 */
export async function px<T>(
  page: Page,
  method: string,
  ...args: unknown[]
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await answerWithin(pxOnce<T>(page, method, args), method);
    } catch (error) {
      const lost = String(error).includes('garbage collected');
      if (lost && REPEATABLE.has(method) && attempt < 3) {
        lostCalls[method] = (lostCalls[method] ?? 0) + 1;
        continue;
      }
      throw new Error(`px ${method}: ${String(error).split('\n')[0]}`);
    }
  }
}

/**
 * A call the page never answers (a write waiting on something that never
 * settles) fails, named and counted, instead of stalling the run.
 */
async function answerWithin<T>(work: Promise<T>, method: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      hungCalls[method] = (hungCalls[method] ?? 0) + 1;
      reject(new Error(`no answer within ${CALL_TIMEOUT_MS} ms`));
    }, CALL_TIMEOUT_MS);
  });
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pxOnce<T>(
  page: Page,
  method: string,
  args: unknown[]
): Promise<T> {
  return (await page.evaluate(
    async ({ path, method, args }) => {
      // Import once per page load, so a call awaits nothing but the method.
      const loaded = (window as unknown as { __px?: unknown }).__px;
      if (!loaded) await import(/* @vite-ignore */ path);
      const api = (
        window as unknown as {
          __px: Record<string, (...a: unknown[]) => unknown>;
        }
      ).__px;
      return await api[method]!(...args);
    },
    { path: HARNESS, method, args }
  )) as T;
}

/** A same-origin request from the page, with its cookies. */
export async function call<T>(
  page: Page,
  url: string,
  method: string,
  body?: unknown
): Promise<{ status: number; body: T }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await page.evaluate(
        async ({ url, method, body }) => {
          const response = await fetch(url, {
            method,
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          return { status: response.status, text: await response.text() };
        },
        { url, method, body }
      );
      let parsed: unknown = result.text;
      try {
        parsed = result.text ? JSON.parse(result.text) : undefined;
      } catch {}
      return { status: result.status, body: parsed as T };
    } catch (error) {
      if (attempt >= 3 || !String(error).includes('Failed to fetch'))
        throw error;
      await sleep(500);
    }
  }
}
export const dss = <T>(
  page: Page,
  path: string,
  method: string,
  body?: unknown
) => call<T>(page, `${ORIGIN}/dss${path}`, method, body);
export const auth = <T>(
  page: Page,
  path: string,
  method: string,
  body?: unknown
) => call<T>(page, `${ORIGIN}/auth${path}`, method, body);

/**
 * Navigates, trying again when the navigation fails: on a machine with many
 * network interfaces Chromium aborts navigations with ERR_NETWORK_CHANGED.
 */
export async function gotoRetrying(page: Page, url: string, timeout = 90_000) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(url, { timeout });
      return;
    } catch (error) {
      if (attempt >= 5) throw error;
      console.log(
        `goto ${new URL(url).pathname} failed, retrying: ${String(error).split('\n')[0]}`
      );
      await page.waitForTimeout(1000);
    }
  }
}

/**
 * Signs `address` in (registering it on first use) and, when `open`, lands a
 * page on the app past onboarding. The app's sign-in is these two requests;
 * the local auth service answers the first with the code.
 */
export async function login(
  context: BrowserContext,
  address: string,
  open: boolean,
  log: (line: string) => void
) {
  const page = await context.newPage();
  await gotoRetrying(page, `${ORIGIN}/auth/health`);
  const status = await page.evaluate(async (address) => {
    const start = await fetch('/auth/login/passwordless', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uri: `${location.origin}/app/login/callback`,
        email: address,
      }),
    });
    const { code } = (await start.json()) as { code: string };
    const done = await fetch(
      `/auth/oauth/passwordless/${code}?email=${encodeURIComponent(address)}&disable_redirect=true`,
      {
        credentials: 'include',
        cache: 'no-store',
      }
    );
    return done.status;
  }, address);
  if (status >= 300)
    throw new Error(`sign-in of ${address} answered ${status}`);
  if (!open) return page;
  await gotoRetrying(page, `${ORIGIN}/app/home`, 120_000);
  const bypass = page.getByRole('button', { name: 'Bypass' });
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(2000);
    if (!page.url().includes('onboarding')) break;
    if (
      await bypass.waitFor({ timeout: 30_000 }).then(
        () => true,
        () => false
      )
    ) {
      await bypass.click({ force: true }).catch(() => {});
      await page
        .waitForURL((url) => !url.pathname.includes('onboarding'), {
          timeout: 30_000,
        })
        .catch(() => {});
    }
  }
  log(`${address.split('@')[0]} signed in at ${new URL(page.url()).pathname}`);
  return page;
}
