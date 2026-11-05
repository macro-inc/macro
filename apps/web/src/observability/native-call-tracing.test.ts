import { invoke } from '@tauri-apps/api/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureNativeCallTracing } from './native-call-tracing';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete window.__MACRO_ANDROID_CALL_TRACING__;
});

it('does not invoke unsupported installed binaries', async () => {
  await configureNativeCallTracing({
    enabled: true,
    tracesUrl: 'https://example.com/v1/traces',
    environment: 'dev',
  });
  expect(invoke).not.toHaveBeenCalled();
});

it('clears native telemetry when the existing telemetry gate is disabled', async () => {
  window.__MACRO_ANDROID_CALL_TRACING__ = true;
  await configureNativeCallTracing({
    enabled: false,
    tracesUrl: 'https://example.com/v1/traces',
    environment: 'dev',
  });
  expect(invoke).toHaveBeenCalledWith('plugin:call-kit|configure_tracing', {
    tracesUrl: null,
    environment: 'dev',
  });
});

it('uses the resolved exporter for supported binaries', async () => {
  window.__MACRO_ANDROID_CALL_TRACING__ = true;
  await configureNativeCallTracing({
    enabled: true,
    tracesUrl: 'http://localhost:4318/v1/traces',
    environment: 'dev',
  });
  expect(invoke).toHaveBeenCalledWith('plugin:call-kit|configure_tracing', {
    tracesUrl: 'http://localhost:4318/v1/traces',
    environment: 'dev',
  });
});
