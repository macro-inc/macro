/**
 * The CPU profile: DevTools slows the WebView renderer by a factor
 * (`Emulation.setCPUThrottlingRate`). The rate lasts only as long as the
 * DevTools connection that set it, so the harness sets it on every attach and
 * checks it around every timed step by timing a fixed loop in the page
 * against the same loop unthrottled.
 */

/** Chrome's "mid-tier mobile" preset; 4 is Android-phone-like for this app. */
const MAX_RATE = 20;

/**
 * How far the measured slowdown may stray from the rate before a step fails.
 * Host load moves the loop's time by up to about a quarter; a rate lost on the
 * way (measured 1× instead of 4×) is far outside.
 */
const TOLERANCE = 1.5;

/** Parses `--cpu-throttle`: one rate or a comma-separated list, each 1–20. */
export function parseCpuThrottle(value: string): number[] {
  const rates = value.split(',').map((part) => Number(part.trim()));
  const valid = rates.every(
    (rate) => Number.isFinite(rate) && rate >= 1 && rate <= MAX_RATE
  );
  if (value.trim() === '' || !valid)
    throw new Error(
      `--cpu-throttle takes rates from 1 to ${MAX_RATE}, such as 4 or 1,4`
    );
  if (new Set(rates).size !== rates.length)
    throw new Error('--cpu-throttle lists a rate twice');
  return rates;
}

/**
 * Runs a fixed arithmetic loop `runs` times in the page and returns each
 * run's milliseconds. Interference only adds time, so callers take the fastest.
 */
export const cpuProbe = (runs: number) => `(() => {
  const times = [];
  for (let run = 0; run < ${runs}; run++) {
    const start = performance.now();
    let value = 0;
    for (let i = 0; i < 1000000; i++) value = (value + Math.sqrt(i * 1.0001)) % 1e9;
    times.push(performance.now() - start);
  }
  return times;
})()`;

/** Whether a measured slowdown shows that `rate` is in force. */
export function throttleInForce(rate: number, measured: number): boolean {
  return measured >= rate / TOLERANCE && measured <= rate * TOLERANCE;
}
