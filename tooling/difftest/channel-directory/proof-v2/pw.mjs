// Browser side of the differential: one Playwright context per page, each
// signed in as one viewer and running one tree in one mode.
//   M: main's bundle (ChannelsContextProvider, REST list + /activity)
//   C: the branch's bundle with the GraphQL device cache (SharedWorker host)
//   N: the branch's bundle with no SharedWorker, so the in-memory directory
// The stack serves the union of both bundles (proof-branch files, plus
// proof-main's hashed files); a main page gets main's index.html and its few
// same-name files from disk.
import fs from 'node:fs';
import path from 'node:path';

export const BASE = (process.env.BASE ?? 'https://localhost:29509').replace(/\/$/, '');
const origin = new URL(BASE).origin;
const BUNDLES = path.join(process.env.HOME, '.cache/gqlchan-bundles');
const MAIN_FILES = new Set(['/app/canvas-render.html', '/app/bundle-manifest.json', '/app/semver.txt']);

const { chromium } = await import(
  path.resolve(process.env.REPO_ROOT + '/node_modules/playwright/index.mjs')
);

export async function launch() {
  return chromium.launch({
    channel: 'chromium',
    args: [
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
      '--js-flags=--max-old-space-size=4096',
    ],
  });
}

const mainIndex = () => fs.readFileSync(path.join(BUNDLES, 'proof-main/index.html'));
const mainFile = (pathname) => fs.readFileSync(path.join(BUNDLES, 'proof-main', pathname.replace(/^\/app\//, '')));

/**
 * @param {{ cookies: string }} session
 * @param {{ tree: 'main'|'branch', mode: 'M'|'C'|'N', mutant?: string, onRequest?: Function, video?: string }} options
 */
export async function viewerPage(browser, session, options) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    ...(options.video ? { recordVideo: { dir: options.video, size: { width: 1280, height: 800 } } } : {}),
  });
  await context.addCookies(
    session.cookies.split('; ').map((pair) => {
      const at = pair.indexOf('=');
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: BASE, httpOnly: true, secure: true };
    })
  );
  await context.addInitScript(
    ({ mode, mutant }) => {
      try {
        localStorage.setItem('macro:login', 'true');
        if (mutant) localStorage.setItem('proof:mutant', mutant);
        else localStorage.removeItem('proof:mutant');
      } catch {}
      if (mode === 'N') {
        try {
          delete window.SharedWorker;
          Object.defineProperty(window, 'SharedWorker', { value: undefined, configurable: true });
        } catch {}
      }
    },
    { mode: options.mode, mutant: options.mutant ?? null }
  );
  await context.route(
    (url) => url.toString().startsWith(`${origin}/`),
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (options.tree === 'main' && url.pathname.startsWith('/app')) {
        if (request.resourceType() === 'document' && !/\.[a-z0-9]+$/i.test(url.pathname)) {
          return route.fulfill({ status: 200, contentType: 'text/html', body: mainIndex() });
        }
        if (MAIN_FILES.has(url.pathname)) {
          const type = url.pathname.endsWith('.html') ? 'text/html' : url.pathname.endsWith('.json') ? 'application/json' : 'text/plain';
          return route.fulfill({ status: 200, contentType: type, body: mainFile(url.pathname) });
        }
      }
      if (url.pathname.startsWith('/i/otlp/')) return route.fulfill({ status: 200, body: '{}' });
      const startedAt = Date.now();
      try {
        const response = await route.fetch({ maxRedirects: 0 });
        options.onRequest?.({
          method: request.method(),
          path: url.pathname,
          search: url.search,
          body: request.postData(),
          status: response.status(),
          startedAt,
          endedAt: Date.now(),
        });
        await route.fulfill({ response });
      } catch {
        await route.abort().catch(() => {});
      }
    }
  );
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error).slice(0, 300)));
  return { context, page, errors, mode: options.mode, tree: options.tree };
}

/** Loads (or reloads) the app and waits for the tree's directory to be complete. */
export async function load(viewer, { reload = false, timeoutMs = 180_000 } = {}) {
  const started = Date.now();
  if (reload) await viewer.page.reload({ waitUntil: 'load', timeout: timeoutMs });
  else await viewer.page.goto(`${BASE}/app/`, { waitUntil: 'load', timeout: timeoutMs });
  await viewer.page.waitForFunction(() => !!window.__proof, null, { timeout: timeoutMs, polling: 100 });
  const ready = await viewer.page.evaluate((ms) => window.__proof.waitReady(ms), timeoutMs);
  return { ready, ms: Date.now() - started, mode: await viewer.page.evaluate(() => window.__proof.mode()) };
}

export function snapshot(viewer, spec) {
  return viewer.page.evaluate((s) => window.__proof.snapshot(s), spec);
}
