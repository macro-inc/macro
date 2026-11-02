import type {
  TelemetryInitConfig,
  TelemetryStartupOptions,
} from '../src/config';
import { Telemetry } from '../src/index';
import { createWebTracingProvider } from '../src/web';

export interface ProbeResult {
  nativeCalls: number;
  failed: boolean;
  requests: {
    url: string;
    credentials?: RequestCredentials;
    mode?: RequestMode;
  }[];
}

declare global {
  interface Window {
    runExporterProbe: (collector: string) => Promise<ProbeResult>;
  }
}

window.runExporterProbe = async (collector) => {
  const browserFetch = globalThis.fetch.bind(globalThis);
  const result: ProbeResult = { nativeCalls: 0, failed: false, requests: [] };
  const rejectNativeFetch = async () => {
    result.nativeCalls++;
    throw new Error(
      'Telemetry reached the authenticated application transport'
    );
  };
  globalThis.fetch = Object.assign(rejectNativeFetch, browserFetch);
  const startup = Promise.resolve().then(
    (): TelemetryStartupOptions => ({
      recording: true,
      tracesUrl: `${collector}/v1/traces`,
      logsUrl: `${collector}/v1/logs`,
    })
  );
  const config: TelemetryInitConfig = {
    serviceName: 'webview-export-probe',
    environment: 'test',
    enabled: async () => true,
    perfSampleRate: 0,
    tracesUrl: 'http://invalid.example/fallback/v1/traces',
    logsUrl: 'http://invalid.example/fallback/v1/logs',
    startup,
    exportFetch: (input, init) => {
      const options: RequestInit = { ...init, credentials: 'omit' };
      result.requests.push({
        url: String(input),
        credentials: options.credentials,
        mode: options.mode,
      });
      return browserFetch(input, options);
    },
  };
  try {
    const ready = Telemetry.init({
      ...config,
      tracingProvider: (resource, getUserId, perfSampled) =>
        createWebTracingProvider(config, resource, getUserId, perfSampled),
    });
    Telemetry.perfSpan('export.early').end();
    await ready;
    Telemetry.perfSpan('export.ready').end();
    Telemetry.info('export.log');
    await Telemetry.flush();
  } catch {
    result.failed = true;
  } finally {
    await Telemetry.shutdown().catch(() => {
      result.failed = true;
    });
    globalThis.fetch = browserFetch;
  }
  return result;
};
