import { Telemetry } from '@macro-inc/observability';
import { beforeEach, expect, it, vi } from 'vitest';
import { initializeBrowserObservability } from './browser';
import { readDesktopDiagnostics } from './desktop';
import { initializeUiOperationTelemetry } from './ui-operation';

vi.mock('@core/util/platform', () => ({
  getPlatform: () => 'desktop',
  isTauri: () => true,
}));
vi.mock('@graphql-cache/rollout-observability', () => ({
  recordBrowserTursoCacheNavigation: vi.fn(),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { init: vi.fn(), info: vi.fn(), flush: vi.fn(), error: vi.fn() },
}));
vi.mock('@macro-inc/observability/web', () => ({
  createWebTracingProvider: vi.fn(),
}));
vi.mock('@macro-inc/observability/zone', () => ({
  ZoneContextManager: class {},
}));
vi.mock('./ui-operation', () => ({
  initializeUiOperationTelemetry: vi.fn(() => vi.fn()),
}));
vi.mock('./desktop', () => ({
  readDesktopDiagnostics: vi.fn(),
  desktopResourceAttributes: () => ({
    'service.instance.id': 'launch-1',
    'macro.recording.id': 'recording-1',
  }),
  createDesktopMemoryRecording: () => ({
    attributes: () => ({}),
    accept: vi.fn(),
    start: vi.fn(),
    dispose: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_ENABLE_BROWSER_OTEL', 'false');
  vi.mocked(Telemetry.init).mockImplementation(async (config) => {
    await config.enabled();
  });
});

it('explicit native recording overrides the normal enablement gate and exporter before startup', async () => {
  vi.mocked(readDesktopDiagnostics).mockResolvedValue({
    identity: {
      instanceId: 'launch-1',
      recordingId: 'recording-1',
      tracesUrl: 'http://localhost:4318/v1/traces',
      nativeVersion: '2.5.0',
      os: 'macos',
      hostPid: 1,
    },
    samples: [],
    droppedSamples: 0,
  });
  await initializeBrowserObservability();
  const config = vi.mocked(Telemetry.init).mock.calls[0][0];
  expect(await config.enabled()).toBe(true);
  expect(config.recording).toBe(true);
  expect(initializeUiOperationTelemetry).toHaveBeenCalledOnce();
  expect(config.tracesUrl).toBe('http://localhost:4318/v1/traces');
  expect(config.logsUrl).toBe('http://localhost:4318/v1/logs');
  expect(config.resourceAttributes).toMatchObject({
    'app.runtime': 'tauri',
    'service.instance.id': 'launch-1',
    'macro.recording.id': 'recording-1',
  });
});

it('an older binary without diagnostics still obeys the normal telemetry gate', async () => {
  vi.mocked(readDesktopDiagnostics).mockResolvedValue(undefined);
  await initializeBrowserObservability();
  const config = vi.mocked(Telemetry.init).mock.calls[0][0];
  expect(await config.enabled()).toBe(false);
  expect(config.recording).toBe(false);
  expect(initializeUiOperationTelemetry).not.toHaveBeenCalled();
  expect(config.resourceAttributes).toMatchObject({
    'app.runtime': 'tauri',
    'app.platform': 'desktop',
  });
});
