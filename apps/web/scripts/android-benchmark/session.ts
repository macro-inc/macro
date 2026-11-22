import { Cdp } from './cdp';
import type { Device } from './device';
import { type CapturedSpan, parseOtlpTraces } from './otlp';
import { cpuProbe, throttleInForce } from './throttle';

/**
 * The benchmark build exports traces to this same-origin path. Tauri's asset
 * handler answers it, so the harness reads each export's body from DevTools
 * (Fetch interception never sees requests the WebView serves itself).
 */
const OTLP_PATH = '/__benchmark/otlp/v1/traces';

/** Where to tap, in screen pixels, and whether the page scrolled to get there. */
export type Located = { x: number; y: number; moved: boolean };

/** One request the page started, seen through DevTools. */
export type PageRequest = {
  /** Epoch milliseconds, device clock. */
  time: number;
  method: string;
  url: string;
};

/** Records the time of each touch the page receives, without handling it. */
const TAP_RECORDER = `(() => {
  if (window.__macroBenchmarkTaps) return;
  const taps = (window.__macroBenchmarkTaps = []);
  window.addEventListener('pointerdown', (event) => {
    taps.push(performance.timeOrigin + event.timeStamp);
  }, { capture: true, passive: true });
})()`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A DevTools connection to the app's WebView that captures its spans. */
export class Session {
  readonly spans: CapturedSpan[] = [];
  readonly requests: PageRequest[] = [];
  /** OTLP exports captured; a cold start that exported before attaching loses those spans. */
  exports = 0;
  /** Exports whose body could not be read: their spans are missing. */
  captureFailures = 0;
  /** The CPU throttle this connection set; it ends with the connection. */
  cpuThrottle = 1;
  /** The CPU probe's fastest run before throttling, in milliseconds. */
  #cpuBaselineMs: number | undefined;
  #listeners: (() => void)[] = [];
  /** Export bodies are read in request order, so a root never lands before its children. */
  #captures: Promise<void> = Promise.resolve();

  private constructor(
    readonly cdp: Cdp,
    readonly device: Device,
    readonly port: number,
    readonly pid: number
  ) {}

  /**
   * Waits for the app's process and WebView, then attaches. A fresh process
   * exports its first spans about five seconds after they end, so attaching
   * must finish well before that.
   */
  static async attach(
    device: Device,
    port: number,
    timeoutMs = 20_000
  ): Promise<Session> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const pid = await device.pid();
      const socket = pid && (await device.devtoolsSocket(pid));
      if (pid && socket) {
        await device.forward(port, socket);
        let cdp: Cdp | undefined;
        try {
          const page = await Session.#page(port, deadline);
          cdp = await Cdp.connect(page, Math.max(deadline - Date.now(), 1));
          const session = new Session(cdp, device, port, pid);
          await session.#start();
          return session;
        } catch (error) {
          cdp?.close();
          await device.removeForward(port);
          throw error;
        }
      }
      await sleep(50);
    }
    throw new Error(
      'The app has no debuggable WebView: is the benchmark build installed?'
    );
  }

  static async #page(port: number, deadline: number): Promise<string> {
    while (Date.now() < deadline) {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((response) => response.json() as Promise<{ type: string; url: string; webSocketDebuggerUrl: string }[]>)
        .catch(() => []);
      const page = pages.find(
        (entry) => entry.type === 'page' && entry.url.includes('tauri.localhost')
      );
      if (page) return page.webSocketDebuggerUrl;
      await sleep(50);
    }
    throw new Error('The app WebView never listed its page');
  }

  async #start() {
    this.#listeners.push(
      this.cdp.on('Network.requestWillBeSent', (params) => {
        const request = params.request as {
          url: string;
          method: string;
          postData?: string;
        };
        if (request.url.includes('/__benchmark/otlp/')) {
          if (request.url.endsWith(OTLP_PATH))
            this.#captures = this.#after(
              this.#captures,
              String(params.requestId),
              request.postData
            );
          return;
        }
        this.requests.push({
          time: Number(params.wallTime) * 1000,
          method: request.method,
          url: request.url,
        });
      })
    );
    await this.cdp.send('Network.enable', { maxPostDataSize: 65536 });
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: TAP_RECORDER,
    });
    await this.cdp.evaluate(TAP_RECORDER);
  }

  async #after(
    previous: Promise<void>,
    requestId: string,
    inline: string | undefined
  ) {
    await previous;
    await this.#capture(requestId, inline);
  }

  async #capture(requestId: string, inline: string | undefined) {
    let body = inline;
    try {
      body ??= (
        await this.cdp.send<{ postData: string }>(
          'Network.getRequestPostData',
          { requestId }
        )
      ).postData;
    } catch (error) {
      this.captureFailures++;
      console.error(`OTLP capture failed: ${(error as Error).message}`);
      return;
    }
    // An exporter retry would deliver the same spans again.
    const seen = new Set(this.spans.map((span) => span.spanId));
    this.spans.push(
      ...parseOtlpTraces(body).filter((span) => !seen.has(span.spanId))
    );
    this.exports++;
  }

  /** Waits for a span that matches, ending at or after `since`. */
  async waitForSpan(
    match: (span: CapturedSpan) => boolean,
    since: number,
    // Slow flows plus the exporter's five-second batching.
    timeoutMs = 40_000
  ): Promise<CapturedSpan | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const span = this.spans.find((entry) => entry.end >= since && match(entry));
      if (span) return span;
      await sleep(100);
    }
    return undefined;
  }

  /** Waits until every export seen so far has been read. */
  async captured(): Promise<void> {
    await this.#captures;
  }

  /** Every captured span in a trace. */
  trace(traceId: string): CapturedSpan[] {
    return this.spans.filter((span) => span.traceId === traceId);
  }

  /** The latest touch the page saw after `since`, in epoch milliseconds. */
  async tapAfter(since: number): Promise<number | undefined> {
    const taps = await this.cdp.evaluate<number[]>(
      'window.__macroBenchmarkTaps ?? []'
    );
    return taps.filter((time) => time >= since).at(-1);
  }

  /**
   * Evaluates an expression that returns candidate elements (one, an array, a
   * NodeList, a promise of one of those, or none) and returns the centre, in
   * screen pixels, of the first one a touch would actually reach: retained
   * hidden views keep copies of rows in the DOM. The WebView fills the screen
   * edge to edge. `moved` says the page scrolled to reach it, so it may not
   * have come to rest yet.
   */
  async locate(expression: string): Promise<Located | undefined> {
    return this.cdp.evaluate<Located | undefined>(`(async () => {
      window.__macroBenchmarkMoved = false;
      const found = await (${expression});
      let moved = window.__macroBenchmarkMoved === true;
      const candidates = found instanceof Element ? [found] : [...(found ?? [])];
      const frame = () => new Promise((done) => requestAnimationFrame(done));
      const reachable = (element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return undefined;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y);
        return hit && (element === hit || element.contains(hit)) ? { x, y } : undefined;
      };
      for (const element of candidates) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        // Keep the target clear of the header and the dock before tapping it.
        if (rect.top < 120 || rect.bottom > innerHeight - 160) {
          element.scrollIntoView({ block: 'center', behavior: 'instant' });
          await frame();
          await frame();
          // Controls in the header stay put: only a scroll counts as a move.
          if (element.getBoundingClientRect().top !== rect.top) moved = true;
        }
        const point = reachable(element);
        if (point) {
          // What guardTap checks the touch against.
          window.__macroBenchmarkTarget = element;
          return { x: point.x * devicePixelRatio, y: point.y * devicePixelRatio, moved };
        }
      }
      return undefined;
    })()`);
  }

  /** Waits for an element and returns its centre in screen pixels. */
  async waitFor(expression: string, timeoutMs = 15_000): Promise<Located> {
    const deadline = Date.now() + timeoutMs;
    let failure = 'no reachable element';
    while (Date.now() < deadline) {
      const point = await this.locate(expression).catch((error: Error) => {
        failure = error.message;
        return undefined;
      });
      if (point) return point;
      await sleep(100);
    }
    throw new Error(`Nothing to tap (${failure}): ${expression.slice(0, 120)}`);
  }

  /**
   * From the next touch on, watches for the first element matching
   * `selector` that a touch would reach, and records when the frame after
   * it was painted: the same paint opportunity the app's spans end at.
   * Checks run in animation frames after DOM changes, so an idle page does
   * no work for them. Read the time with {@link contentPainted}.
   */
  async watchContent(selector: string): Promise<void> {
    await this.cdp.evaluate(`(() => {
      window.__macroBenchmarkContent?.stop();
      const state = (window.__macroBenchmarkContent = { painted: undefined });
      const selector = ${JSON.stringify(selector)};
      let scheduled = false;
      let observer;
      let interval;
      const visible = () => [...document.querySelectorAll(selector)].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }).slice(0, 20).some((element) => {
        const rect = element.getBoundingClientRect();
        const y = rect.top + rect.height / 2;
        if (y < 0 || y > innerHeight) return false;
        const hit = document.elementFromPoint(rect.left + rect.width / 2, y);
        return hit && element.contains(hit);
      });
      const check = () => {
        scheduled = false;
        if (!observer || !visible()) return;
        state.stop();
        requestAnimationFrame(() => {
          state.painted = performance.timeOrigin + performance.now();
        });
      };
      const schedule = () => {
        if (scheduled || !observer) return;
        scheduled = true;
        requestAnimationFrame(check);
      };
      const arm = () => {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
        // Layout can reveal a row without a DOM change.
        interval = setInterval(schedule, 200);
        schedule();
      };
      state.stop = () => {
        removeEventListener('pointerdown', arm, true);
        observer?.disconnect();
        observer = undefined;
        clearInterval(interval);
      };
      addEventListener('pointerdown', arm, { capture: true, once: true, passive: true });
    })()`);
  }

  /**
   * Guards the next touch: the list can move between finding the target and
   * the touch landing (a row above it gets a message and moves up), and the
   * touch would then open another row. Unless the touch lands inside the
   * element the last {@link locate} returned, and that element shows no
   * unread items when `refuseUnread` is set, the page drops the touch and the
   * events that follow it. {@link tapRefused} says whether it did.
   */
  async guardTap(unreadSelector: string | undefined): Promise<void> {
    await this.clearTapGuard();
    await this.cdp.evaluate(`(() => {
      const target = window.__macroBenchmarkTarget;
      const unread = ${JSON.stringify(unreadSelector ?? null)};
      const guard = (window.__macroBenchmarkGuard = { refused: undefined });
      const drop = (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const follow = ['pointerup', 'pointercancel', 'touchstart', 'touchend', 'mousedown', 'mouseup', 'click'];
      const check = (event) => {
        if (!target || !target.isConnected || !(event.target instanceof Node) || !target.contains(event.target))
          guard.refused = 'the touch landed outside the target';
        else if (unread && target.querySelector(unread))
          guard.refused = 'the target shows unread items';
        if (!guard.refused) return;
        drop(event);
        for (const type of follow) addEventListener(type, drop, { capture: true });
        setTimeout(() => {
          for (const type of follow) removeEventListener(type, drop, { capture: true });
        }, 2000);
      };
      addEventListener('pointerdown', check, { capture: true, once: true });
      guard.remove = () => removeEventListener('pointerdown', check, { capture: true });
    })()`);
  }

  /** Removes a guard whose touch never arrived, so it cannot catch the next one. */
  async clearTapGuard(): Promise<void> {
    await this.cdp.evaluate('window.__macroBenchmarkGuard?.remove?.()');
  }

  /** Why the guarded touch was dropped, if it was. */
  async tapRefused(): Promise<string | undefined> {
    return (
      (await this.cdp.evaluate<string | null>(
        'window.__macroBenchmarkGuard?.refused ?? null'
      )) ?? undefined
    );
  }

  /**
   * Waits until a list has finished reacting to a scroll: no element says it
   * is loading (`aria-busy`) and the scroll containers' heights have held
   * for half a second. Throws when that takes longer than `timeoutMs`: a
   * step timed then would include the loading.
   */
  async waitForQuiet(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const state = await this.cdp.evaluate<string>(`(() => {
        const busy = document.querySelector('[aria-busy="true"]') !== null;
        const heights = [...document.querySelectorAll('[data-soup-entity]')]
          .slice(0, 1)
          .map((row) => {
            let scroller = row.parentElement;
            while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
            return scroller ? scroller.scrollHeight : 0;
          });
        return (busy ? 'busy' : 'idle') + ':' + document.querySelectorAll('[data-soup-entity]').length + ':' + heights.join(',');
      })()`);
      if (state !== last) {
        last = state;
        stableSince = Date.now();
      } else if (!state.startsWith('busy') && Date.now() - stableSince >= 500) return;
      await sleep(100);
    }
    throw new Error(`The list did not come to rest within ${timeoutMs} ms`);
  }

  /** When the watched content was painted, waiting up to `timeoutMs`. */
  async contentPainted(timeoutMs = 40_000): Promise<number | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const painted = await this.cdp.evaluate<number | undefined>(
        'window.__macroBenchmarkContent?.painted'
      );
      if (painted !== undefined) return painted;
      await sleep(100);
    }
    return undefined;
  }

  /** Stops watching for content, if a watch is still running. */
  async stopWatchingContent(): Promise<void> {
    await this.cdp.evaluate('window.__macroBenchmarkContent?.stop()');
  }

  /**
   * Slows the WebView renderer by `rate` (1 leaves it alone) and checks that
   * the rate took effect. Times the CPU probe first, unthrottled, as the
   * reference for later checks; interference only adds time, so the fastest
   * run is the reference.
   */
  async throttleCpu(rate: number): Promise<void> {
    this.#cpuBaselineMs = Math.min(
      ...(await this.cdp.evaluate<number[]>(cpuProbe(3)))
    );
    await this.cdp.send('Emulation.setCPUThrottlingRate', { rate });
    this.cpuThrottle = rate;
    await this.checkCpuThrottle();
  }

  /**
   * Measures the slowdown in force by timing the CPU probe against its
   * unthrottled time, and throws when it is not the rate this session set.
   */
  async checkCpuThrottle(): Promise<number> {
    if (this.#cpuBaselineMs === undefined)
      throw new Error('Call throttleCpu before measuring a step');
    const [probeMs] = await this.cdp.evaluate<number[]>(cpuProbe(1));
    const measured = probeMs / this.#cpuBaselineMs;
    if (!throttleInForce(this.cpuThrottle, measured))
      throw new Error(
        `CPU throttle ${this.cpuThrottle}× is not in force: the page runs ${measured.toFixed(1)}× slower than unthrottled`
      );
    return measured;
  }

  async route(): Promise<string> {
    return this.cdp.evaluate<string>('location.pathname + location.hash');
  }

  async detach() {
    for (const unlisten of this.#listeners) unlisten();
    await this.#captures;
    this.cdp.close();
    await this.device.removeForward(this.port);
  }
}
