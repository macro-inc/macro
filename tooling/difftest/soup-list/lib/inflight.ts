/**
 * Page loads against the dev servers, bounded and observable. A Vite dev
 * page loads a few thousand modules; many pages loading at once on a busy
 * machine left some of them blank or waiting on a module for good. Every
 * page load (sign-in, reload) takes a slot here, and every page's requests
 * are tracked so a stuck page can say what it was waiting for.
 */
import type { Page, Request } from 'playwright';

const LIMIT = Number(process.env.DIFFTEST_PAGE_LOADS ?? 4);
let active = 0;
const waiting: (() => void)[] = [];

/** Runs one page load in a slot; at most LIMIT run at once across all lanes. */
export async function pageLoad<T>(work: () => Promise<T>): Promise<T> {
  if (active < LIMIT) active++;
  else await new Promise<void>((resolve) => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else active--;
  }
}

const inflight = new WeakMap<Page, Map<Request, number>>();

export function trackRequests(page: Page) {
  const open = new Map<Request, number>();
  inflight.set(page, open);
  page.on('request', (r) => open.set(r, Date.now()));
  page.on('requestfinished', (r) => open.delete(r));
  page.on('requestfailed', (r) => open.delete(r));
}

/** The page's requests still open after `olderThanMs`: method, path, type, age. */
export function pendingRequests(page: Page, olderThanMs = 15_000): string[] {
  const now = Date.now();
  return [...(inflight.get(page) ?? [])]
    .filter(([, at]) => now - at >= olderThanMs)
    .map(([r, at]) => `${r.method()} ${new URL(r.url()).pathname.slice(0, 100)} ${r.resourceType()} ${Math.round((now - at) / 1000)}s`)
    .slice(0, 12);
}
