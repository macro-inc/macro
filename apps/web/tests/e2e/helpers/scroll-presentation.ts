import type { Page } from '@playwright/test';

type ResizeObserverDelayState = {
  matchedCallbacks: number;
  releaseAt?: number;
};

type BottomPresentationSample = {
  time: number;
  distanceFromBottom: number;
};

type TargetPresentationSample = {
  time: number;
  center: number;
  positioned: boolean;
  visible: boolean;
  scrollTop: number;
  targetHeight: number;
  targetTop: number;
  virtualItemTop?: number;
  virtualItemStyleTop?: string;
  virtualItemVisibility?: string;
  usableViewportHeight: number;
  insetStart: number;
  insetEnd: number;
};

export type BottomPresentationReport = {
  first?: BottomPresentationSample;
  firstViolation?: BottomPresentationSample;
  violationCount: number;
};

export type TargetPresentationReport = {
  first?: TargetPresentationSample;
  firstPositioned?: TargetPresentationSample;
  last?: TargetPresentationSample;
  unpositionedBeforeLandingCount: number;
  largestShiftAfterPositioned: number;
  firstPositionLoss?: TargetPresentationSample;
  positionLossCount: number;
  lastChangeAt?: number;
};

declare global {
  interface Window {
    __e2eResizeObserverDelay?: ResizeObserverDelayState;
    __e2eBottomPresentation?: BottomPresentationReport;
    __e2eResetBottomPresentation?: () => void;
    __e2eTargetPresentation?: TargetPresentationReport;
    __e2eResetTargetPresentation?: () => void;
    __e2eStopTargetPresentation?: () => void;
  }
}

/**
 * Sample painted target positions. A normal target must fit inside the usable
 * viewport; a target taller than that viewport must cover it. Insets exclude
 * floating mobile chrome from the usable viewport. Once the target lands, any
 * later movement or position loss is a user-visible second-pass correction.
 */
export async function observeTargetPresentation(
  page: Page,
  scrollSelector: string,
  targetSelector: string,
  tolerancePx = 1
) {
  await page.addInitScript(
    ({ scrollSelector, targetSelector, tolerancePx }) => {
      const createReport = (): TargetPresentationReport => ({
        unpositionedBeforeLandingCount: 0,
        largestShiftAfterPositioned: 0,
        positionLossCount: 0,
      });
      let report = createReport();
      window.__e2eTargetPresentation = report;
      let stopped = false;
      let previousSample: TargetPresentationSample | undefined;

      const verify = () => {
        if (stopped) return;

        const target = document.querySelector<HTMLElement>(targetSelector);
        const scroller =
          target?.closest<HTMLElement>(scrollSelector) ??
          document.querySelector<HTMLElement>(scrollSelector);
        if (scroller && target) {
          const scrollRect = scroller.getBoundingClientRect();
          const targetRect = target.getBoundingClientRect();
          const insetStart = Number(
            scroller.dataset.channelScrollInsetStart ?? 0
          );
          const insetEnd = Number(scroller.dataset.channelScrollInsetEnd ?? 0);
          const usableTop = scrollRect.top + insetStart;
          const usableBottom = scrollRect.bottom - insetEnd;
          const usableViewportHeight = Math.max(0, usableBottom - usableTop);
          const virtualItem = target.closest<HTMLElement>(
            '[data-channel-thread-row]'
          )?.parentElement;
          const targetStyle = getComputedStyle(target);
          const visible =
            targetStyle.display !== 'none' &&
            targetStyle.visibility !== 'hidden' &&
            targetRect.bottom > usableTop &&
            targetRect.top < usableBottom;
          const positioned =
            visible &&
            (targetRect.height <= usableViewportHeight
              ? targetRect.top >= usableTop - tolerancePx &&
                targetRect.bottom <= usableBottom + tolerancePx
              : targetRect.top <= usableTop + tolerancePx &&
                targetRect.bottom >= usableBottom - tolerancePx);
          const sample: TargetPresentationSample = {
            time: performance.now(),
            center:
              targetRect.top +
              targetRect.height / 2 -
              (usableTop + usableViewportHeight / 2),
            positioned,
            visible,
            scrollTop: scroller.scrollTop,
            targetHeight: targetRect.height,
            targetTop: targetRect.top,
            virtualItemTop: virtualItem?.getBoundingClientRect().top,
            virtualItemStyleTop: virtualItem?.style.top,
            virtualItemVisibility: virtualItem?.style.visibility,
            usableViewportHeight,
            insetStart,
            insetEnd,
          };
          report.first ??= sample;
          report.last = sample;

          if (!report.firstPositioned) {
            if (sample.positioned) {
              report.firstPositioned = sample;
              report.lastChangeAt = sample.time;
            } else if (sample.visible) {
              report.unpositionedBeforeLandingCount += 1;
            }
          } else {
            if (
              !previousSample ||
              Math.abs(sample.center - previousSample.center) > tolerancePx ||
              sample.positioned !== previousSample.positioned
            ) {
              report.lastChangeAt = sample.time;
            }
            report.largestShiftAfterPositioned = Math.max(
              report.largestShiftAfterPositioned,
              Math.abs(sample.center - report.firstPositioned.center)
            );
            if (!sample.positioned) {
              report.firstPositionLoss ??= sample;
              report.positionLossCount += 1;
            }
          }
          previousSample = sample;
        }

        schedulePostPaintCheck();
      };

      const schedulePostPaintCheck = () => {
        requestAnimationFrame(() => window.setTimeout(verify, 0));
      };

      window.__e2eStopTargetPresentation = () => {
        stopped = true;
      };
      window.__e2eResetTargetPresentation = () => {
        report = createReport();
        window.__e2eTargetPresentation = report;
        previousSample = undefined;
      };
      schedulePostPaintCheck();
    },
    { scrollSelector, targetSelector, tolerancePx }
  );

  return {
    reset: async () => {
      await page.evaluate(() => window.__e2eResetTargetPresentation?.());
    },
    waitForFirstPositioned: async () => {
      await page.waitForFunction(
        () => window.__e2eTargetPresentation?.firstPositioned !== undefined,
        undefined,
        { timeout: 10_000 }
      );
      return page.evaluate(
        () => window.__e2eTargetPresentation as TargetPresentationReport
      );
    },
    waitForQuietAndRead: async (quietMs = 250) => {
      await page.waitForFunction(
        (quiet) => {
          const report = window.__e2eTargetPresentation;
          return (
            report?.firstPositioned !== undefined &&
            report.lastChangeAt !== undefined &&
            performance.now() - report.lastChangeAt >= quiet
          );
        },
        quietMs,
        { timeout: 10_000 }
      );
      return page.evaluate(() => {
        window.__e2eStopTargetPresentation?.();
        return window.__e2eTargetPresentation as TargetPresentationReport;
      });
    },
  };
}

/**
 * Delay ResizeObserver callbacks for a DOM subtree to make layout races deterministic.
 * When `activateWhenSelector` is set, callbacks remain native until that element exists.
 */
export async function delayResizeObserverFor(
  page: Page,
  selector: string,
  delayMs: number,
  activateWhenSelector?: string
) {
  await page.addInitScript(
    ({ selector, delayMs, activateWhenSelector }) => {
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
            const isActivated =
              !activateWhenSelector ||
              document.querySelector(activateWhenSelector) !== null;
            if (!matchesSubtree || !isActivated) {
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
    { selector, delayMs, activateWhenSelector }
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
      let report: BottomPresentationReport;
      const reset = () => {
        report = { violationCount: 0 };
        window.__e2eBottomPresentation = report;
      };
      window.__e2eResetBottomPresentation = reset;
      reset();

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
    reset: () => page.evaluate(() => window.__e2eResetBottomPresentation?.()),
    waitForSampleAndRead: async () => {
      await page.waitForFunction(
        () => window.__e2eBottomPresentation?.first !== undefined,
        undefined,
        { timeout: 30_000 }
      );
      return page.evaluate(
        () => window.__e2eBottomPresentation as BottomPresentationReport
      );
    },
    read: () =>
      page.evaluate(
        () => window.__e2eBottomPresentation as BottomPresentationReport
      ),
  };
}
