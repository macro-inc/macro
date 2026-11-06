/**
 * Named User Timing marks for load and navigation phases (`macro.<name>`).
 * They show up in DevTools Performance traces and PerformanceObserver; with
 * `VITE_PERF_LOG=true` each one is also logged as `[perf] <name> <ms>`.
 */
export function perfMark(name: string, detail?: Record<string, unknown>) {
  if (typeof performance === 'undefined') return;
  const mark = performance.mark(`macro.${name}`, { detail });
  if (import.meta.env.VITE_PERF_LOG === 'true') {
    console.info(
      `[perf] ${name} ${Math.round(mark.startTime)}ms`,
      ...(detail ? [JSON.stringify(detail)] : [])
    );
  }
}
