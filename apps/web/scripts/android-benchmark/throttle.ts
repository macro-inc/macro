/**
 * The CPU profile: DevTools slows the WebView renderer by a factor
 * (`Emulation.setCPUThrottlingRate`). The rate lasts only as long as the
 * DevTools connection that set it, so the harness sets it on every attach and
 * checks it around every timed step by timing a fixed loop in the page
 * against the same loop unthrottled.
 */

/**
 * Rates from 2 up: below that the check cannot tell a throttle in force from
 * one that lapsed. 4 is Chrome's "mid-tier mobile" preset.
 */
const MIN_RATE = 2;
const MAX_RATE = 20;

/** Parses `--cpu-throttle`: one rate or a comma-separated list. */
export function parseCpuThrottle(value: string): number[] {
  const parts = value.split(',').map((part) => part.trim());
  const rates = parts.map(Number);
  const valid = parts.every(
    (part, index) =>
      /^\d+(\.\d+)?$/.test(part) &&
      (rates[index] === 1 ||
        (rates[index] >= MIN_RATE && rates[index] <= MAX_RATE))
  );
  if (!valid)
    throw new Error(
      `--cpu-throttle takes 1 or rates from ${MIN_RATE} to ${MAX_RATE}, such as 4 or 1,4`
    );
  if (new Set(rates).size !== rates.length)
    throw new Error('--cpu-throttle lists a rate twice');
  return rates;
}

/**
 * Runs a fixed arithmetic loop `runs` times in the page and returns each
 * run's milliseconds. DevTools throttles by pausing the thread for slices of
 * time, so a short run can fall between pauses: each run takes about 50 ms
 * unthrottled, long enough to span several.
 */
export const cpuProbe = (runs: number) => `(() => {
  const times = [];
  for (let run = 0; run < ${runs}; run++) {
    const start = performance.now();
    let value = 0;
    for (let i = 0; i < 4000000; i++) value = (value + Math.sqrt(i * 1.0001)) % 1e9;
    times.push(performance.now() - start);
  }
  return times;
})()`;

/**
 * Whether a measured slowdown shows that `rate` is in force. A throttle that
 * lapsed measures about 1×, so the slowdown must be nearer the rate than 1×
 * (on a log scale). Host load only makes the probe slower, so there is no
 * upper bound, and at 1× nothing can have lapsed: a fresh connection starts
 * unthrottled.
 */
export function throttleInForce(rate: number, measured: number): boolean {
  return rate === 1 || measured >= Math.sqrt(rate);
}
