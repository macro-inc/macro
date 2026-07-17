import type { Page } from '@playwright/test';

type ResizeObserverDelayState = {
  matchedCallbacks: number;
  releaseAt?: number;
};

type BottomPresentationSample = {
  time: number;
  distanceFromBottom: number;
};

export type BottomPresentationReport = {
  first?: BottomPresentationSample;
  firstViolation?: BottomPresentationSample;
  violationCount: number;
};

declare global {
  interface Window {
    __e2eResizeObserverDelay?: ResizeObserverDelayState;
    __e2eBottomPresentation?: BottomPresentationReport;
  }
}

/** Delay ResizeObserver callbacks for a DOM subtree to make layout races deterministic. */
export async function delayResizeObserverFor(
  page: Page,
  selector: string,
  delayMs: number
) {
  await page.addInitScript(
    ({ selector, delayMs }) => {
      const NativeResizeObserver = window.ResizeObserver;
      const state: ResizeObserverDelayState = { matchedCallbacks: 0 };
      window.__e2eResizeObserverDelay = state;

      class DelayedResizeObserver implements ResizeObserver {
        private readonly observer: ResizeObserver;
        private queuedEntries?: ResizeObserverEntry[];
        private timer?: number;
        private disconnected = false;

        constructor(callback: ResizeObserverCallback) {
          this.observer = new NativeResizeObserver((entries) => {
            const matchesSubtree = entries.some(
              ({ target }) =>
                target.matches(selector) || target.closest(selector) !== null
            );
            if (!matchesSubtree) {
              callback(entries, this);
              return;
            }

            state.matchedCallbacks += 1;
            state.releaseAt ??= performance.now() + delayMs;
            const remaining = state.releaseAt - performance.now();
            if (remaining <= 0) {
              callback(entries, this);
              return;
            }

            this.queuedEntries = entries;
            if (this.timer !== undefined) return;
            this.timer = window.setTimeout(() => {
              this.timer = undefined;
              const pendingEntries = this.queuedEntries;
              this.queuedEntries = undefined;
              if (!this.disconnected && pendingEntries) {
                callback(pendingEntries, this);
              }
            }, remaining);
          });
        }

        observe(target: Element, options?: ResizeObserverOptions) {
          this.observer.observe(target, options);
        }

        unobserve(target: Element) {
          this.observer.unobserve(target);
        }

        disconnect() {
          this.disconnected = true;
          if (this.timer !== undefined) window.clearTimeout(this.timer);
          this.observer.disconnect();
        }
      }

      window.ResizeObserver = DelayedResizeObserver;
    },
    { selector, delayMs }
  );

  return {
    async waitForRelease() {
      await page.waitForFunction(() => {
        const releaseAt = window.__e2eResizeObserverDelay?.releaseAt;
        return releaseAt !== undefined && performance.now() >= releaseAt;
      });
      // Let released measurements and their resulting render commit.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          })
      );
      return page.evaluate(() => window.__e2eResizeObserverDelay);
    },
  };
}

/** Observe the post-paint bottom distance of every visible overflowing frame. */
export async function observeBottomPresentation(
  page: Page,
  selector: string,
  tolerancePx = 1
) {
  await page.addInitScript(
    ({ selector, tolerancePx }) => {
      const report: BottomPresentationReport = { violationCount: 0 };
      window.__e2eBottomPresentation = report;

      const verify = () => {
        const scroller = document.querySelector<HTMLElement>(selector);
        if (scroller) {
          const style = getComputedStyle(scroller);
          const visible =
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            scroller.getClientRects().length > 0;
          const overflowing = scroller.scrollHeight > scroller.clientHeight;

          if (visible && overflowing) {
            const sample = {
              time: performance.now(),
              distanceFromBottom:
                scroller.scrollHeight -
                scroller.clientHeight -
                scroller.scrollTop,
            };
            report.first ??= sample;
            if (sample.distanceFromBottom > tolerancePx) {
              report.firstViolation ??= sample;
              report.violationCount += 1;
            }
          }
        }

        schedulePostPaintCheck();
      };

      // Timers queued from rAF run after that frame's paint. This observes what
      // a user could see without racing the app's own rAF corrections.
      const schedulePostPaintCheck = () => {
        requestAnimationFrame(() => window.setTimeout(verify, 0));
      };

      schedulePostPaintCheck();
    },
    { selector, tolerancePx }
  );

  return {
    read: () =>
      page.evaluate(
        () => window.__e2eBottomPresentation as BottomPresentationReport
      ),
  };
}
