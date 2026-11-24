// Two copies of the web app on the same backend: main's code (old) and the
// branch's (new), each served by its own Vite from its own worktree, both
// driven by one Chromium. Each side reads through its own code: the probe
// module is imported into the running page, and the Home list is read from
// the DOM it renders.

import { startModuleCache } from './module-cache.ts';
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright';
import type { Snapshot } from './compare.ts';
import type { DomRow } from './compare.ts';
import type { User } from './stack.ts';

export type Side = 'old' | 'new' | 'old-flag-off';

export type AppServer = {
  side: Side;
  worktree: string;
  port: number;
  origin: string;
  process: ChildProcess;
};

export type ViteEnv = {
  backendProxy: string;
  routes: string;
  caPem: string;
  hostname: string;
  /** The notified sort flag, on unless a run compares against it off. */
  notifiedSort?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startApp(
  side: Side,
  worktree: string,
  port: number,
  env: ViteEnv,
  probeSource: string,
  logDir: string
): Promise<AppServer> {
  const web = join(worktree, 'apps/web');
  mkdirSync(join(web, 'src/__proof__'), { recursive: true });
  copyFileSync(probeSource, join(web, 'src/__proof__/probe.ts'));
  const log = openSync(join(logDir, `vite-${side}.log`), 'a');
  const vite = join(worktree, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [vite, '-c', 'vite.config.ts', '--port', String(port), '--strictPort'], {
    cwd: web,
    env: {
      ...process.env,
      PORT: String(port),
      VITE_LOCAL_SERVERS: 'ALL',
      MACRO_LOCAL_HOSTNAME: env.hostname,
      NODE_EXTRA_CA_CERTS: env.caPem,
      VITE_LOCAL_BACKEND_ORIGIN: 'same-origin',
      MACRO_LOCAL_BACKEND_PROXY: env.backendProxy,
      MACRO_LOCAL_BACKEND_ROUTES: env.routes,
      VITE_AI_EDITING_WORKER_URL: '/ai-editing',
      VITE_LOCAL_STACK: 'true',
      VITE_ENABLE_BROWSER_OTEL: 'false',
      // The flag under test; on in both apps, so main serves notified lists
      // over REST and the branch over GraphQL.
      VITE_ENABLE_INBOX_NOTIFIED_SORT: env.notifiedSort === false ? 'false' : 'true',
    },
    stdio: ['pipe', log, log],
  });
  const origin = `http://localhost:${port}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${side} vite exited ${child.exitCode}`);
    const ok = await fetch(`${origin}/app/`).then(
      (r) => r.ok,
      () => false
    );
    if (ok) return { side, worktree, port, origin, process: child };
    await sleep(500);
  }
  throw new Error(`${side} vite did not start on ${port}`);
}

export function stopApp(app: AppServer) {
  app.process.stdin?.end();
  app.process.kill('SIGTERM');
}

/**
 * One headless Chromium for both apps. Unless PROOF_NETNS=0 it runs in a
 * network namespace of its own (chromium-netns.sh), reaching only the two
 * dev servers, so container restarts on the host cannot fail its requests.
 */
export async function launchBrowser(): Promise<Browser> {
  const base = Number(process.env.PROOF_PORT_BASE ?? 30110);
  const isolated = process.env.PROOF_NETNS !== '0';
  if (isolated && !process.env.PROOF_SOCAT) throw new Error('set PROOF_SOCAT to a socat binary, or PROOF_NETNS=0');
  // PROOF_MODULE_CACHE=0 sends modules through uncached (socat only).
  const cache = isolated && process.env.PROOF_MODULE_CACHE !== '0' ? await startModuleCache([base, base + 1]) : undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(isolated
      ? {
          executablePath: join(import.meta.dirname, 'chromium-netns.sh'),
          env: { ...process.env, PROOF_CHROMIUM: chromium.executablePath(), PROOF_NETNS_PORTS: `${base},${base + 1}`, PROOF_NETNS_HOSTDIR: cache?.dir ?? '' },
        }
      : {}),
    args: ['--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  });
  if (cache) browser.on('disconnected', cache.close);
  return browser;
}

/** A request the browser gave up on: no response reached the page. */
export type RequestFailure = { at: string; side: Side; url: string; method: string; error: string };

let requestFailureSink: ((failure: RequestFailure) => void) | undefined;
/** Every lane opened after this reports its failed requests to `sink`. */
export function onRequestFailure(sink: (failure: RequestFailure) => void) {
  requestFailureSink = sink;
}

export type Lane = {
  side: Side;
  app: AppServer;
  context: BrowserContext;
  page: Page;
  touch: boolean;
  /** Failed requests since the lane opened, oldest first. */
  failed: RequestFailure[];
};

/** A signed-in page for `user` on `app`, with the probe loaded. */
export async function openLane(
  browser: Browser,
  app: AppServer,
  user: User,
  options: { touch?: boolean; video?: string; facets?: Record<string, string[]>; path?: string } = {}
): Promise<Lane> {
  const touch = options.touch ?? false;
  const context = await browser.newContext({
    viewport: touch ? { width: 430, height: 900 } : { width: 1400, height: 1000 },
    hasTouch: touch,
    isMobile: touch,
    ...(options.video ? { recordVideo: { dir: options.video, size: { width: 1280, height: 900 } } } : {}),
  });
  await context.addCookies(
    user.cookie.split('; ').map((pair) => {
      const at = pair.indexOf('=');
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: app.origin };
    }).concat([{ name: 'login', value: 'true', url: app.origin }])
  );
  const storageKey = `macro:home:filters:v1:${encodeURIComponent(user.macroUserId)}`;
  await context.addInitScript(
    ([key, value]) => {
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {}
    },
    [storageKey, options.facets ? JSON.stringify({ version: 1, tab: 'signal', facets: options.facets }) : ''] as const
  );
  const page = await context.newPage();
  const failed: RequestFailure[] = [];
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    const failure = { at: new Date().toISOString(), side: app.side, url: `${url.origin}${url.pathname}`, method: request.method(), error: request.failure()?.errorText ?? 'unknown' };
    failed.push(failure);
    requestFailureSink?.(failure);
  });
  // Opening every lane at once (the sequences phase opens 192 pages) starves
  // the dev servers until loads time out: a few page loads at a time.
  const release = await acquireLoadSlot();
  try {
  // A page load fetches about a thousand modules from the dev server; the
  // browser fails them all when the host's network changes (failed
  // requests, above). Load the page again then, a few times.
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(`${app.origin}${options.path ?? "/app/home"}`, { waitUntil: "domcontentloaded", timeout: 180_000 });
      await loadProbe(page);
      break;
    } catch (error) {
      if (attempt >= 4) throw error;
    }
  }
  } finally {
    release();
  }
  return { side: app.side, app, context, page, touch, failed };
}

/** Load a new document in an open lane (to `url`, or the same one), a few
 * page loads at a time across the run, retrying as openLane does. */
export async function reloadLane(lane: Lane, url?: string, options: { probe?: boolean } = {}) {
  const release = await acquireLoadSlot();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        if (url) await lane.page.goto(url, { waitUntil: "domcontentloaded", timeout: 180_000 });
        else await lane.page.reload({ waitUntil: "domcontentloaded", timeout: 180_000 });
        if (options.probe) await loadProbe(lane.page);
        return;
      } catch (error) {
        if (attempt >= 4) throw error;
      }
    }
  } finally {
    release();
  }
}

const LOAD_SLOTS = Number(process.env.PROOF_OPEN_CONCURRENCY ?? 6);
let loadsRunning = 0;
const loadWaiters: (() => void)[] = [];

async function acquireLoadSlot(): Promise<() => void> {
  while (loadsRunning >= LOAD_SLOTS) await new Promise<void>((resolve) => loadWaiters.push(resolve));
  loadsRunning += 1;
  return () => {
    loadsRunning -= 1;
    loadWaiters.shift()?.();
  };
}

export async function loadProbe(page: Page) {
  const deadline = Date.now() + 120_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      await page.evaluate(async () => {
        await import(/* @vite-ignore */ '/src/__proof__/probe.ts');
      });
      if (await page.evaluate(() => Boolean((window as never as { __proofProbe?: unknown }).__proofProbe))) return;
    } catch (error) {
      last = error;
      // A failed module fetch stays failed for the document (e.g. after Vite
      // re-optimized dependencies): load a new document before retrying.
      await sleep(1000);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    }
    await sleep(1000);
  }
  throw new Error(`probe did not load: ${String(last)}`);
}

export type Source =
  | { kind: 'home'; tab: 'signal' | 'noise'; facets: Record<string, string[]>; foreignEntities: boolean }
  | { kind: 'filter'; filters: Record<string, unknown>; confined: boolean; emailView?: 'inbox' }
  | { kind: 'preset'; tab: 'signal' | 'noise' };

export type ReadSpec = {
  source: Source;
  /** Overrides applied to the args' params (page size, direction). */
  params?: Record<string, unknown>;
  groupBy?: unknown;
  showForeign?: boolean;
  fresh?: boolean;
  allPages?: boolean;
  maxPages?: number;
  /** Drop lists no reader holds before reading (see probe.ts). */
  clean?: boolean;
};

export type ProbeResult = Snapshot & { ms: number; args: unknown; resets?: { during: number; sinceLoad: number } };

/** Reads through the side's own facade; the args are built in the page. */
export async function probeRead(lane: Lane, userId: string, spec: ReadSpec): Promise<ProbeResult> {
  return lane.page.evaluate(
    ({ userId, spec }) => (window as never as { __proofProbe: any }).__proofProbe.readSpec(userId, spec),
    { userId, spec }
  );
}

export async function probeOpenLive(lane: Lane, id: string, userId: string, spec: ReadSpec): Promise<ProbeResult> {
  return lane.page.evaluate(
    ({ id, userId, spec }) => (window as never as { __proofProbe: any }).__proofProbe.openLiveSpec(id, userId, spec),
    { id, userId, spec }
  );
}

export async function probeSnapLive(lane: Lane, id: string): Promise<(Snapshot & { settled: boolean }) | null> {
  return lane.page.evaluate((id) => {
    const probe = (window as never as { __proofProbe: any }).__proofProbe;
    const snap = probe.snapLive(id);
    return snap ? { ...snap, settled: probe.liveSettled(id) } : null;
  }, id);
}

/**
 * The Home list as the viewer sees it: every row of the grid, in order, with
 * date headers, after scrolling the virtualized grid end to end.
 */
export async function readHomeDom(lane: Lane, maxRows = 400): Promise<DomRow[]> {
  return lane.page.evaluate(async (maxRows) => {
    const grid = document.querySelector('[role="grid"][aria-label="Home"]') as HTMLElement | null;
    if (!grid) return [{ kind: 'header', label: '<no grid>' }] as never;
    // The virtualized scroller sits inside the grid on desktop and touch; take
    // whichever scrollable element, in or around the grid, holds the most.
    const scroller = (() => {
      const candidates = [grid, ...(grid.querySelectorAll("*") as unknown as HTMLElement[])];
      for (let el = grid.parentElement; el; el = el.parentElement) candidates.push(el);
      let best: HTMLElement = grid;
      for (const el of candidates) {
        if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
        if (el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight) best = el;
      }
      return best;
    })();
    const rows = new Map<string, { top: number; row: unknown }>();
    // The row's text as textContent gives it, but with its relative time (its
    // last text, a node of its own) set apart by a space: run together, a
    // title ending in a digit and the time read ambiguously ("Event 2" + "1m"
    // is "Event 21m", as is "Event " + "21m").
    const textOf = (root: Element) => {
      const parts: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? '');
      let last = parts.length - 1;
      while (last > 0 && !parts[last].trim()) last -= 1;
      if (last > 0 && /^(now|\d+(mo|m|h|d|w|y))$/.test(parts[last].trim())) parts[last] = ` ${parts[last]}`;
      return parts.join('').replace(/\s+/g, ' ').trim();
    };
    const collect = () => {
      for (const el of grid.querySelectorAll('[role="row"]')) {
        const h = el as HTMLElement;
        const top = h.getBoundingClientRect().top + scroller.scrollTop;
        const entity = h.getAttribute('data-soup-entity');
        if (entity !== null || (h.id && !h.id.includes("group-header"))) {
          const text = textOf(h.querySelector('[data-home-item]') ?? h);
          const labels = [...h.querySelectorAll('[aria-label]')].map((x) => x.getAttribute('aria-label') ?? '').sort();
          rows.set(`e:${h.id || entity}`, {
            top,
            row: {
              kind: 'entity',
              id: h.id || String(entity),
              text,
              unread: labels.includes('Unread'),
              labels,
            },
          });
        } else {
          const label = h.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          if (label) rows.set(`h:${label}:${Math.round(top)}`, { top, row: { kind: 'header', label } });
        }
      }
    };
    scroller.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 50));
    let guard = 0;
    while (guard++ < 400) {
      collect();
      if (rows.size >= maxRows) break;
      const before = scroller.scrollTop;
      scroller.scrollTop = before + scroller.clientHeight * 0.8;
      await new Promise((r) => setTimeout(r, 60));
      if (scroller.scrollTop === before) {
        // At the end: give a next page a moment to arrive.
        await new Promise((r) => setTimeout(r, 400));
        collect();
        scroller.scrollTop = scroller.scrollHeight;
        await new Promise((r) => setTimeout(r, 400));
        if (scroller.scrollTop === before) break;
      }
    }
    collect();
    scroller.scrollTop = 0;
    return [...rows.values()].sort((a, b) => a.top - b.top).map((x) => x.row) as never;
  }, maxRows);
}

/** A mounted reader's query flags and loaded pages, for the evidence of a miss. */
export async function probeLiveDebug(lane: Lane, id: string): Promise<unknown> {
  return lane.page.evaluate((id) => {
    const probe = (window as never as { __proofProbe: any }).__proofProbe;
    return { ...probe.liveDebug(id), resets: probe.resetReopens().length };
  }, id);
}
