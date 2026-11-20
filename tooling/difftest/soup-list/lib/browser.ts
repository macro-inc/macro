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
                });
        } catch {}
      }
      await route.fulfill({ status: 200, body: '{}' });
    });
    await login(page, origins[side], email);
    session.pages[side] = page;
  }
  for (const side of ['new', 'old'] as const) await loadProbe(session, side, probePath[side]);
  return session;
}

export async function loadProbe(session: UserSession, side: Side, path: string) {
  const page = session.pages[side];
  await page.waitForFunction(() => document.readyState === 'complete');
  // Vite may still be serving the reload's module graph: retry the import.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.evaluate(async (p) => {
        await import(/* @vite-ignore */ p);
      }, path);
      return;
    } catch (error) {
      if (attempt >= 4 || !String(error).includes('dynamically imported module')) throw error;
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
