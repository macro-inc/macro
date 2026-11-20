/** Driver-side calls into `window.__probe` on one page. */
import type { Page } from 'playwright';

export type Snapshot = {
  settled: boolean;
  data: unknown;
  caller: unknown;
  status: Record<string, unknown>;
};

export type Settled = Snapshot & { waitedMs: number; timedOut: boolean };

export async function mount(page: Page, key: string, name: string, params?: unknown) {
  await page.evaluate(
    ({ key, name, params }) => (window as any).__probe.mount(key, name, params),
    { key, name, params }
  );
}

export async function unmount(page: Page, key: string) {
  await page.evaluate((key) => (window as any).__probe.unmount(key), key);
}

export async function resetQueries(page: Page) {
  await page.evaluate(() => (window as any).__probe.resetQueries());
}

/**
 * Waits in the page until the reader is settled and its snapshot has not
 * changed for `stableMs`, or until `timeoutMs`; returns the last snapshot.
 * `until`, when given, is a JSON-path-free predicate source run on the
 * snapshot (for live checks: wait until the expected change shows).
 */
export async function settle(
  page: Page,
  key: string,
  opts: { timeoutMs: number; stableMs?: number; until?: string }
): Promise<Settled> {
  return await page.evaluate(
    async ({ key, timeoutMs, stableMs, until }) => {
      const probe = (window as any).__probe;
      const predicate = until ? (new Function('s', `return (${until})(s)`) as (s: unknown) => boolean) : undefined;
      const start = performance.now();
      let last = '';
      let since = start;
      for (;;) {
        const snap = probe.snapshot(key);
        const json = JSON.stringify(snap);
        const now = performance.now();
        if (json !== last) {
          last = json;
          since = now;
        }
        const ok = snap.settled && (!predicate || predicate(snap));
        if (ok && now - since >= stableMs)
          return { ...snap, waitedMs: Math.round(now - start), timedOut: false };
        if (now - start >= timeoutMs)
          return { ...snap, waitedMs: Math.round(now - start), timedOut: true };
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    { key, timeoutMs: opts.timeoutMs, stableMs: opts.stableMs ?? 400, until: opts.until }
  );
}

export async function oneShot(page: Page, name: string, params?: unknown) {
  return await page.evaluate(
    ({ name, params }) => (window as any).__probe.oneShot(name, params),
    { name, params }
  );
}

export async function translate(page: Page, args: unknown): Promise<unknown> {
  return await page.evaluate((args) => (window as any).__probe.translate(args), args);
}

export async function flushTelemetry(page: Page) {
  await page.evaluate(() => (window as any).__probe.flushTelemetry());
}
