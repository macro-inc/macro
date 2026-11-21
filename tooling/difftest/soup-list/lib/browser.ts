/**
 * One Chromium for the whole run. Each synthetic user gets one context; in it,
 * one page per app origin (old = main, new = branch), both logged in as that
 * user. Pages load the real app, then import the probe module.
 */
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from 'playwright';
import { pendingRequests, trackRequests } from './inflight';
import { login } from './login';

export type Side = 'old' | 'new';

export type Origins = Record<Side, string>;

let browser: Browser | undefined;

export async function launch(): Promise<Browser> {
  browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage', '--js-flags=--max-old-space-size=8192'],
  });
  return browser;
}

export async function closeBrowser(): Promise<void> {
  const b = browser;
  browser = undefined;
  await b?.close().catch(() => {});
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    void closeBrowser().finally(() => process.exit(130));
  });
}
process.on('exit', () => {
  // Best effort: the browser process dies with its pipe when we exit.
});

export type UserSession = {
  email: string;
  context: BrowserContext;
  pages: Record<Side, Page>;
  /** Spans the page exported, by name. */
  spans: Record<Side, ExportedSpan[]>;
  /** Soup requests the page sent, by kind. */
  requests: Record<Side, SoupRequest[]>;
  /** GraphQL bodies already replayed on the old page. */
  replayed?: Set<string>;
};

export type ExportedSpan = {
  name: string;
  attributes: Record<string, unknown>;
  status?: number;
  at: number;
  /** Wall-clock start and duration, from the span itself. */
  start?: number;
  ms?: number;
};

export type SoupRequest = {
  kind: 'rest-flat' | 'rest-grouped' | 'rest-group-page' | 'rest-legacy' | 'graphql';
  op?: string;
  /** The GraphQL request body, kept to replay the read elsewhere. */
  body?: string;
  at: number;
};

function attrValue(v: Record<string, unknown>): unknown {
  for (const k of ['stringValue', 'boolValue', 'intValue', 'doubleValue'])
    if (k in v) return v[k];
  return JSON.stringify(v);
}

function classifyRequest(url: string, body: string | null): SoupRequest | undefined {
  const path = new URL(url).pathname;
  const at = Date.now();
  if (path.endsWith('/items/soup/ast/grouped')) return { kind: 'rest-grouped', at };
  if (path.includes('/items/soup/ast/grouped/')) return { kind: 'rest-group-page', at };
  if (path.endsWith('/items/soup/ast')) return { kind: 'rest-flat', at };
  if (path.endsWith('/items/soup')) return { kind: 'rest-legacy', at };
  if (path.endsWith('/graphql') && body?.includes('"operationName"')) {
    try {
      const op = JSON.parse(body).operationName as string;
      if (/soup/i.test(op)) return { kind: 'graphql', op, body, at };
    } catch {}
  }
  return undefined;
}


export async function openUser(
  b: Browser,
  origins: Origins,
  email: string,
  probePath: Record<Side, string>,
  cookies?: Parameters<BrowserContext["addCookies"]>[0]
): Promise<UserSession> {
  const context = await b.newContext({ viewport: { width: 1280, height: 900 } });
  // A dev server loading many app pages at once is slow to answer.
  context.setDefaultNavigationTimeout(180_000);
  context.setDefaultTimeout(180_000);
  try {
    return await fillSession(context, origins, email, probePath, cookies);
  } catch (error) {
    // A page that never opened leaves its context behind: close it, so a retry starts clean.
    await context.close().catch(() => {});
    throw error;
  }
}

async function fillSession(
  context: BrowserContext,
  origins: Origins,
  email: string,
  probePath: Record<Side, string>,
  cookies?: Parameters<BrowserContext["addCookies"]>[0]
): Promise<UserSession> {
  if (cookies) await context.addCookies(cookies);
  const session: UserSession = {
    email,
    context,
    pages: {} as Record<Side, Page>,
    spans: { old: [], new: [] },
    requests: { old: [], new: [] },
  };
  for (const side of ['new', 'old'] as const) {
    const page = await context.newPage();
    page.on('request', (request) => {
      const r = classifyRequest(request.url(), request.postData());
      if (r) session.requests[side].push(r);
    });
    await page.route('**/i/otlp/v1/traces', async (route) => {
      const body = route.request().postData();
      if (body) {
        try {
          const json = JSON.parse(body);
          for (const rs of json.resourceSpans ?? [])
            for (const ss of rs.scopeSpans ?? [])
              for (const span of ss.spans ?? [])
                session.spans[side].push({
                  name: span.name,
                  attributes: Object.fromEntries(
                    (span.attributes ?? []).map(
                      (a: { key: string; value: Record<string, unknown> }) => [
                        a.key,
                        attrValue(a.value),
                      ]
                    )
                  ),
                  status: span.status?.code,
                  at: Date.now(),
                  ...(span.startTimeUnixNano && span.endTimeUnixNano && {
                    start: Number(BigInt(span.startTimeUnixNano) / 1_000_000n),
                    ms: Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / 1_000_000n),
                  }),
                });
        } catch {}
      }
      await route.fulfill({ status: 200, body: '{}' });
    });
    watchCacheErrors(page);
    await login(page, origins[side], email);
    registerPage(page, { origin: origins[side], email, probePath: probePath[side] });
    session.pages[side] = page;
  }
  for (const side of ['new', 'old'] as const) await loadProbe(session, side, probePath[side]);
  return session;
}

/**
 * Where each app page signs in and which probe it loads, so a page the app
 * navigated away (a sign-out, a reload that never finished) can be put back.
 */
const pageHome = new WeakMap<Page, { origin: string; email: string; probePath: string }>();
export function registerPage(page: Page, home: { origin: string; email: string; probePath: string }) {
  pageHome.set(page, home);
}

/**
 * The GraphQL cache's errors, as each page logged them: a live update the
 * branch misses is matched against the cache resets in its page.
 */
export type CacheEvent = { at: number; text: string };
const cacheEvents = new WeakMap<Page, CacheEvent[]>();
export function watchCacheErrors(page: Page) {
  trackRequests(page);
  const events: CacheEvent[] = [];
  cacheEvents.set(page, events);
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/graphql-cache|cache worker|owner epoch|physical reset|graphql_cache/.test(text)) events.push({ at: Date.now(), text: text.slice(0, 160) });
  });
}
export function cacheEventsBetween(page: Page, from: number, to: number): CacheEvent[] {
  return (cacheEvents.get(page) ?? []).filter((e) => e.at >= from && e.at <= to);
}

/** Puts a page back in the app with its probe; true if it had to. */
export async function ensurePage(page: Page): Promise<boolean> {
  const healthy = await page.evaluate(() => Boolean((window as any).__probe)).catch(() => false);
  if (healthy) return false;
  await rebootPage(page);
  return true;
}

/** Loads a page into the app again, signed in, with its probe, whatever state it is in. */
export async function rebootPage(page: Page): Promise<void> {
  const home = pageHome.get(page);
  if (!home) throw new Error('page has no registered home');
  for (let attempt = 0; ; attempt++) {
    try {
      await login(page, home.origin, home.email);
      await page.waitForFunction(() => document.readyState === 'complete');
      await importProbe(page, home.probePath);
      return;
    } catch (error) {
      if (attempt >= 2) throw error;
      await Bun.sleep(5_000);
    }
  }
}

export async function loadProbe(session: UserSession, side: Side, path: string) {
  await importProbe(session.pages[side], path);
}

async function importProbe(page: Page, path: string) {
  await page.waitForFunction(() => document.readyState === 'complete');
  // Vite may still be serving the reload's module graph: retry the import.
  for (let attempt = 0; ; attempt++) {
    try {
      const imported = page.evaluate(async (p) => {
        await import(/* @vite-ignore */ p);
      }, path);
      // A module request that never answers would hold this await forever.
      await Promise.race([imported, Bun.sleep(120_000).then(() => { throw new Error(`probe import still loading after 120 s; open requests: ${pendingRequests(page).join(', ') || 'none'}`); })]);
      return;
    } catch (error) {
      if (attempt >= 4 || !/dynamically imported module|probe import still loading/.test(String(error))) throw error;
      await Bun.sleep(1_000 * (attempt + 1));
      // A module that failed once stays failed in this document: load it again.
      if (attempt >= 1) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.readyState === 'complete');
      }
    }
  }
}

export async function reloadApp(session: UserSession, side: Side, path: string) {
  const page = session.pages[side];
  await page.reload({ waitUntil: 'domcontentloaded' });
  await loadProbe(session, side, path);
}
