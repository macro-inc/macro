type DevPerfPayload = {
  hypothesisId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
};

declare global {
  interface Window {
    __macroPerf?: DevPerfPayload[];
  }
}

const DEV_PERF_PATH = '/__macro_perf';

export function devPerfLog(
  hypothesisId: string,
  location: string,
  message: string,
  data: Record<string, unknown> = {}
) {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;

  const payload: DevPerfPayload = {
    hypothesisId,
    location,
    message,
    data,
    timestamp: Date.now(),
  };

  window.__macroPerf ??= [];
  window.__macroPerf.push(payload);
  console.info('[macro-perf]', payload);

  const body = JSON.stringify(payload);
  if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
    navigator.sendBeacon(
      DEV_PERF_PATH,
      new Blob([body], { type: 'application/json' })
    );
    return;
  }

  void fetch(DEV_PERF_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}
