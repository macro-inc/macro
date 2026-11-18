import { Telemetry } from '@macro-inc/observability';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initializeBrowserObservability } from './browser';
import { readDesktopDiagnostics } from './desktop';
import { clearDocumentLifecycle } from './document-lifecycle';
import { frontendInstanceId } from './frontend-instance';
import { startRuntimeResourceSampling } from './runtime-resources';
import { initializeUiOperationTelemetry } from './ui-operation';

const startupSpan = vi.hoisted(() => ({
  setAttr: vi.fn(),
  end: vi.fn(),
}));

vi.mock('@core/util/platform', () => ({
  getPlatform: () => 'desktop',
  isTauri: () => true,
}));
vi.mock('@graphql-cache/rollout-observability', () => ({
  recordBrowserTursoCacheNavigation: vi.fn(),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    init: vi.fn(),
    info: vi.fn(),
    flush: vi.fn(),
    error: vi.fn(),
    span: vi.fn(() => startupSpan),
  },
}));
vi.mock('@macro-inc/observability/web', () => ({
  createWebTracingProvider: vi.fn(),
  StackContextManager: class {},
}));
vi.mock('./typing-burst', () => ({
  startTypingBurstTelemetry: vi.fn(() => vi.fn()),
}));

vi.mock('./runtime-resources', () => ({
  startRuntimeResourceSampling: vi.fn(() => vi.fn()),
}));
vi.mock('./boot', () => ({ startBootTrace: vi.fn() }));
vi.mock('./os-type', () => ({ osType: () => 'linux' }));
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

afterEach(clearDocumentLifecycle);

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
  expect((await config.startup)?.recording).toBe(true);
  expect(startRuntimeResourceSampling).toHaveBeenCalledOnce();
  const read = vi.mocked(startRuntimeResourceSampling).mock.calls[0][0];
  expect(await read?.()).toEqual({});
  expect(initializeUiOperationTelemetry).toHaveBeenCalledOnce();
  expect((await config.startup)?.tracesUrl).toBe(
    'http://localhost:4318/v1/traces'
  );
  expect((await config.startup)?.logsUrl).toBe('http://localhost:4318/v1/logs');
  expect(config.resourceAttributes).toMatchObject({
    'app.runtime': 'tauri',
    frontend_instance_id: frontendInstanceId,
    'service.instance.id': 'launch-1',
    'macro.recording.id': 'recording-1',
  });
  expect(config.spanAttributes?.()).toMatchObject({
    frontend_instance_id: frontendInstanceId,
    native_instance_id: 'launch-1',
  });
  expect(Telemetry.span).toHaveBeenCalledWith('native.webview.start');
  expect(startupSpan.setAttr).toHaveBeenCalledWith(
    'native_instance_id',
    'launch-1'
  );
  expect(startupSpan.end).toHaveBeenCalledOnce();
});

it('drops browser and extension noise from window errors but reports app errors', async () => {
  vi.mocked(readDesktopDiagnostics).mockResolvedValue(undefined);
  const addEventListener = vi.spyOn(window, 'addEventListener');
  await initializeBrowserObservability();
  const onError = addEventListener.mock.calls.find(
    ([type]) => type === 'error'
  )?.[1] as (event: ErrorEvent) => void;
  addEventListener.mockRestore();
  const appError = new Error('boom');

  onError(
    new ErrorEvent('error', {
      message: 'ResizeObserver loop completed with undelivered notifications.',
    })
  );
  onError(
    new ErrorEvent('error', {
      message: "Cannot read properties of undefined (reading 'M_ID')",
      filename:
        'chrome-extension://eppiocemhmnlbhjplcgkofciiegomcon/content.js',
    })
  );
  onError(
    new ErrorEvent('error', {
      message: 'boom',
      filename: 'https://macro.com/app/app-gifhAVYj.js',
      error: appError,
    })
  );

  expect(Telemetry.error).toHaveBeenCalledOnce();
  expect(Telemetry.error).toHaveBeenCalledWith(appError, {
    'error.source': 'window',
  });
});

it('an older binary without diagnostics still obeys the normal telemetry gate', async () => {
  sessionStorage.setItem(
    'macro-document-lifecycle',
    JSON.stringify({
      frontendInstanceId: '11111111-1111-4111-8111-111111111111',
      startedAtMs: Date.now() - 1000,
      updatedAtMs: Date.now() - 1000,
      visible: true,
    })
  );
  vi.mocked(readDesktopDiagnostics).mockResolvedValue(undefined);
  await initializeBrowserObservability();
  const config = vi.mocked(Telemetry.init).mock.calls[0][0];
  expect(await config.enabled()).toBe(false);
  expect((await config.startup)?.recording).toBe(false);
  expect(initializeUiOperationTelemetry).toHaveBeenCalledOnce();
  expect(config.resourceAttributes).toMatchObject({
    'app.runtime': 'tauri',
    'app.platform': 'desktop',
    'os.type': 'linux',
  });
  expect(startupSpan.setAttr).toHaveBeenCalledWith(
    'previous_document_checkpoint_available',
    true
  );
  expect(startupSpan.setAttr).toHaveBeenCalledWith(
    'previous_document_pagehide_observed',
    false
  );
});

it('revokes the previous document identity if logout happens while telemetry initializes', async () => {
  sessionStorage.setItem(
    'macro-document-lifecycle',
    JSON.stringify({
      frontendInstanceId: '11111111-1111-4111-8111-111111111111',
      startedAtMs: Date.now() - 1000,
      updatedAtMs: Date.now() - 1000,
      visible: true,
    })
  );
  vi.mocked(readDesktopDiagnostics).mockResolvedValue(undefined);
  const reached = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  vi.mocked(Telemetry.init).mockImplementation(async () => {
    reached.resolve();
    await resume.promise;
  });
  const initializing = initializeBrowserObservability();
  await reached.promise;
  clearDocumentLifecycle();
  resume.resolve();
  await initializing;
  expect(startupSpan.setAttr).toHaveBeenCalledWith(
    'previous_document_checkpoint_available',
    false
  );
  expect(startupSpan.setAttr).not.toHaveBeenCalledWith(
    'previous_document_instance_id',
    expect.anything()
  );
});

it('registers the native provider before waiting for a single enablement decision', async () => {
  vi.mocked(readDesktopDiagnostics).mockResolvedValue(undefined);
  const decide = Promise.withResolvers<void>();
  const reached = Promise.withResolvers<void>();
  const onProviderReady = vi.fn();
  vi.mocked(Telemetry.init).mockImplementation(async (config) => {
    // Every consumer must get the same decision, including the exporter.
    expect(config.enabled()).toBe(config.enabled());
    reached.resolve();
    await decide.promise;
  });
  const initializing = initializeBrowserObservability(onProviderReady);
  await reached.promise;
  expect(onProviderReady).toHaveBeenCalledOnce();
  expect(initializeUiOperationTelemetry).toHaveBeenCalledOnce();
  decide.resolve();
  await initializing;
});

it('registers the provider and releases native render while diagnostics remain pending', async () => {
  let finish: (snapshot: undefined) => void = () => {};
  vi.mocked(readDesktopDiagnostics).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const ready = vi.fn();
  const initialization = initializeBrowserObservability(ready);
  expect(Telemetry.init).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
  expect(initializeUiOperationTelemetry).toHaveBeenCalledOnce();
  finish(undefined);
  await initialization;
});
