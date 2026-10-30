import puppeteer, {
  type Browser,
  type BrowserContext,
  type BrowserWorker,
  type Page,
} from '@cloudflare/puppeteer';
import { BrowserWebSocketTransport } from '@cloudflare/puppeteer/internal/common/BrowserWebSocketTransport.js';
import { Telemetry } from '@macro-inc/observability';
import { z } from 'zod';
import type { CanvasBrowserConfig } from './render';

// Only remote identifiers and counters survive requests. Each lease reconnects
// with a fresh request-owned CDP socket; no Puppeteer object is shared globally.
type Lease = {
  busy: boolean;
  contextId?: string;
  sessionId?: string;
  created: number;
  used: number;
  uses: number;
};
const localPools = new Map<string, Lease[]>();
const workerPools = new WeakMap<BrowserWorker, Map<string, Lease[]>>();
function reserve(config: CanvasBrowserConfig): Lease {
  let pools = localPools;
  if (config.BROWSER && !config.CANVAS_BROWSER_URL) {
    pools = workerPools.get(config.BROWSER) ?? new Map<string, Lease[]>();
    workerPools.set(config.BROWSER, pools);
  }
  const key = JSON.stringify([
    config.CANVAS_BROWSER_URL,
    config.CANVAS_RENDER_URL,
  ]);
  if (!pools.has(key) && pools.size >= 4)
    throw new Error('Canvas renderer configuration capacity reached.');
  const pool = pools.get(key) ?? [];
  pools.set(key, pool);
  const slot = pool.find((entry) => !entry.busy);
  if (slot) {
    slot.busy = true;
    return slot;
  }
  if (pool.length >= 2)
    throw new Error(
      'Canvas renderer is busy; retry the read after current work finishes. The current render/measurement was not executed; reread before retrying any edit.'
    );
  const entry = { busy: true, created: Date.now(), used: Date.now(), uses: 0 };
  pool.push(entry);
  return entry;
}

async function connectWorker(
  binding: BrowserWorker,
  lease: Lease,
  signal: AbortSignal
) {
  if (lease.sessionId) {
    const sessions = await puppeteer.sessions(binding);
    signal.throwIfAborted();
    if (sessions.some((session) => session.sessionId === lease.sessionId)) {
      try {
        return await puppeteer.connect(binding, lease.sessionId);
      } catch (error) {
        // Expiry can race discovery. Cold retry only when the old session is
        // actually gone; do not retry unrelated browser/network failures.
        const current = await puppeteer.sessions(binding);
        signal.throwIfAborted();
        if (current.some((session) => session.sessionId === lease.sessionId))
          throw error;
      }
    }
  }
  lease.sessionId = undefined;
  lease.contextId = undefined;
  signal.throwIfAborted();
  return puppeteer.launch(binding, { keep_alive: 60_000 });
}

/** Late startup completion must release its browser/socket even after cancellation. */
async function startResource<T>(
  pending: Promise<T>,
  signal: AbortSignal,
  release: (resource: T) => void
): Promise<T> {
  void pending.then(
    (resource) => {
      if (signal.aborted) release(resource);
    },
    () => {}
  );
  signal.throwIfAborted();
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([pending, cancelled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function withRenderPage<T>(
  config: CanvasBrowserConfig,
  width: number,
  height: number,
  signal: AbortSignal | undefined,
  run: (page: Page) => Promise<T>
): Promise<T> {
  const startupSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(25_000)])
    : AbortSignal.timeout(25_000);
  const lease = reserve(config);
  try {
    return await Telemetry.span('canvas.ai.browser_lease', async (span) => {
      const renderUrl = new URL(config.CANVAS_RENDER_URL);
      const origin = renderUrl.origin;
      let browserWSEndpoint: string | undefined;
      if (config.CANVAS_BROWSER_URL) {
        const endpoint = new URL(config.CANVAS_BROWSER_URL);
        const version = z
          .object({ webSocketDebuggerUrl: z.string().url() })
          .parse(
            await (
              await fetch(new URL('/json/version', endpoint), {
                signal: startupSignal,
              })
            ).json()
          );
        const socket = new URL(version.webSocketDebuggerUrl);
        socket.host = endpoint.host;
        socket.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
        browserWSEndpoint = socket.toString();
      }
      const transport = browserWSEndpoint
        ? await startResource(
            BrowserWebSocketTransport.create(browserWSEndpoint),
            startupSignal,
            (value) => value.close()
          )
        : undefined;
      let browser: Browser | undefined;
      try {
        const pending = transport
          ? puppeteer.connect({
              transport,
              ignoreHTTPSErrors: true,
              protocolTimeout: 20_000,
            })
          : config.BROWSER
            ? connectWorker(config.BROWSER, lease, startupSignal)
            : undefined;
        if (pending)
          browser = await startResource(pending, startupSignal, (value) => {
            if (config.CANVAS_BROWSER_URL) value.disconnect();
            else void value.close().catch(() => {});
          });
      } catch (error) {
        transport?.close();
        lease.sessionId = undefined;
        lease.contextId = undefined;
        throw error;
      }
      if (!browser)
        throw new Error('Canvas browser rendering is not configured.');
      let context: BrowserContext | undefined;
      const abort = () => {
        void context?.close().catch(() => {});
      };
      signal?.addEventListener('abort', abort, { once: true });
      startupSignal.addEventListener('abort', abort, { once: true });
      try {
        signal?.throwIfAborted();
        if (!config.CANVAS_BROWSER_URL) lease.sessionId = browser.sessionId();
        // A tiny anonymous marker lets a later isolate reap ONLY our expired
        // contexts after a crash, without touching unrelated CDP browser tabs.
        const markerUrl = `about:blank#macro-canvas-render:${encodeURIComponent(renderUrl.toString())}`;
        for (const candidate of browser.browserContexts()) {
          if (!candidate.id) continue;
          const marker = (await candidate.pages()).find(
            (page) => page.url() === markerUrl
          );
          if (!marker) continue;
          const expires = await marker.evaluate(() => Number(window.name));
          if (Number.isFinite(expires) && expires > 0 && expires < Date.now())
            await candidate.close();
        }
        const existing = lease.contextId
          ? browser
              .browserContexts()
              .find((entry) => entry.id === lease.contextId)
          : undefined;
        const expired =
          Date.now() - lease.used > 60_000 ||
          Date.now() - lease.created > 300_000 ||
          lease.uses >= 40;
        if (existing && expired) await existing.close();
        context =
          existing && !expired
            ? existing
            : await startResource(
                browser.createBrowserContext(),
                startupSignal,
                (value) => {
                  void value.close().catch(() => {});
                }
              );
        let warm = context === existing && !expired;
        span.setAttr('canvas.browser.warm', warm);
        lease.contextId = context.id;
        if (!warm) {
          lease.created = Date.now();
          lease.uses = 0;
        }
        signal?.throwIfAborted();
        const pages = await context.pages();
        let marker = pages.find((page) => page.url() === markerUrl);
        if (!marker) {
          marker = await startResource(
            context.newPage(),
            startupSignal,
            (value) => {
              void value.close().catch(() => {});
            }
          );
          await marker.goto(markerUrl);
        }
        await marker.evaluate((expires) => {
          window.name = String(expires);
        }, Date.now() + 150_000);
        const previous = pages.find((page) => page.url() !== markerUrl);
        if (!previous) warm = false;
        span.setAttr('canvas.browser.warm', warm);
        const page =
          previous ??
          (await startResource(context.newPage(), startupSignal, (value) => {
            void value.close().catch(() => {});
          }));
        page.setDefaultTimeout(20_000);
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          const url = new URL(request.url());
          // Only the application's render bundle/fonts may load. No API, referenced
          // assets, arbitrary URLs, live sync or navigation from serialized text.
          const allowed =
            url.origin === origin &&
            (url.pathname === renderUrl.pathname ||
              ['script', 'stylesheet', 'font'].includes(
                request.resourceType()
              ));
          void (allowed ? request.continue() : request.abort()).catch(() => {});
        });
        if (!warm)
          await Telemetry.span('canvas.ai.page_load', async () => {
            await page.goto(renderUrl.toString(), {
              waitUntil: 'domcontentloaded',
              timeout: 25_000,
            });
            await page.waitForFunction(
              'typeof window.renderCanvasSnapshot === "function" && typeof window.measureCanvasSnapshot === "function" && typeof window.resetCanvasSnapshot === "function"'
            );
            await page.evaluate(async () => {
              await window.document.fonts.ready;
            });
          });
        await Telemetry.span('canvas.ai.fonts', async () => {
          await page.evaluate(() => window.prepareCanvasRender());
        });
        startupSignal.throwIfAborted();
        startupSignal.removeEventListener('abort', abort);
        signal?.throwIfAborted();
        try {
          return await run(page);
        } catch (error) {
          lease.contextId = undefined;
          throw error;
        } finally {
          // Dispose Solid roots/editors, remove scene closures and DOM. The warm page
          // retains only the static renderer bundle/fonts, never a user's scene.
          await Telemetry.span('canvas.ai.page_reset', async () => {
            await page.evaluate(() => window.resetCanvasSnapshot());
            const retained = await page.evaluate(
              () => document.getElementById('root')?.childElementCount ?? 0
            );
            if (retained !== 0)
              throw new Error('Canvas renderer failed to clear its scene.');
          });
          const metrics = await page.metrics();
          span.setAttr(
            'canvas.browser.heap_bytes',
            metrics.JSHeapUsedSize ?? 0
          );
          if ((metrics.JSHeapUsedSize ?? 0) > 256_000_000)
            lease.contextId = undefined;
          await marker.evaluate((expires) => {
            window.name = String(expires);
          }, Date.now() + 60_000);
          lease.used = Date.now();
          lease.uses++;
        }
      } catch (error) {
        lease.contextId = undefined;
        await context?.close().catch(() => {});
        throw error;
      } finally {
        signal?.removeEventListener('abort', abort);
        startupSignal.removeEventListener('abort', abort);
        if (signal?.aborted || lease.contextId !== context?.id) {
          lease.contextId = undefined;
          await context?.close().catch(() => {});
        }
        await browser.disconnect();
      }
    });
  } finally {
    lease.busy = false;
  }
}
