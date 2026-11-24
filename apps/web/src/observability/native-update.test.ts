import { afterEach, expect, it, vi } from 'vitest';
import type { Report } from './generated/native-update';
import {
  NATIVE_UPDATE_EVENT,
  nativeUpdateAttributes,
  reportNativeUpdate,
} from './native-update';

const telemetry = vi.hoisted(() => {
  const spans: {
    name: string;
    options: unknown;
    end: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    track: vi.fn(),
    spans,
    span: vi.fn((name: string, options: unknown) => {
      const span = {
        name,
        options,
        end: vi.fn(),
        error: vi.fn(),
        run: <T>(operation: () => T) => operation(),
      };
      spans.push(span);
      return span;
    }),
  };
});
vi.mock('@app/lib/analytics', () => ({
  analytics: { track: telemetry.track },
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { span: telemetry.span },
}));

afterEach(() => {
  vi.clearAllMocks();
  telemetry.spans.length = 0;
});

function report(outcome: Report['outcome']): Report {
  return {
    startedAtMs: 1_000,
    durationMs: 500,
    currentVersion: '2026.1106.1',
    bundleLocation: 'applications',
    outcome,
  };
}

it('reports a downloaded update with its check and download timing', () => {
  reportNativeUpdate(
    report({
      kind: 'downloaded',
      target_version: '2026.1119.1',
      download_ms: 300,
      download_bytes: 4096,
      resumed_bytes: 1024,
    })
  );
  const attributes = {
    native_update_outcome: 'downloaded',
    native_update_current_version: '2026.1106.1',
    native_update_bundle_location: 'applications',
    native_update_started_at_ms: 1_000,
    native_update_duration_ms: 500,
    native_update_target_version: '2026.1119.1',
    native_update_download_ms: 300,
    native_update_download_bytes: 4096,
    native_update_resumed_bytes: 1024,
  };
  expect(telemetry.track).toHaveBeenCalledWith(NATIVE_UPDATE_EVENT, attributes);
  const [check, download] = telemetry.spans;
  expect(check).toMatchObject({
    name: 'native.update.check',
    options: { startTime: 1_000, attributes },
  });
  expect(check?.end).toHaveBeenCalledWith(1_500);
  expect(check?.error).not.toHaveBeenCalled();
  expect(download).toMatchObject({
    name: 'native.update.download',
    options: { startTime: 1_200 },
  });
  expect(download?.end).toHaveBeenCalledWith(1_500);
});

it('marks failed checks with the failure kind, IO kind and HTTP status', () => {
  reportNativeUpdate(
    report({
      kind: 'download_failed',
      target_version: '2026.1119.1',
      download_ms: 400,
      failure: { kind: 'request', io_kind: null, http_status: 404 },
      consecutive_failures: 2,
    })
  );
  expect(telemetry.track).toHaveBeenCalledWith(
    NATIVE_UPDATE_EVENT,
    expect.objectContaining({
      native_update_outcome: 'download_failed',
      native_update_failure_kind: 'request',
      native_update_io_kind: undefined,
      native_update_http_status: 404,
      native_update_consecutive_failures: 2,
    })
  );
  const [check, download] = telemetry.spans;
  expect(check?.error).toHaveBeenCalledWith(
    'native update download_failed: request'
  );
  expect(download).toMatchObject({
    name: 'native.update.download',
    options: { startTime: 1_100 },
  });
  expect(download?.error).toHaveBeenCalledOnce();
});

it('sends a found update to PostHog only; its check span comes later', () => {
  reportNativeUpdate(
    report({ kind: 'update_found', target_version: '2026.1119.1' })
  );
  expect(telemetry.track).toHaveBeenCalledWith(
    NATIVE_UPDATE_EVENT,
    expect.objectContaining({ native_update_outcome: 'update_found' })
  );
  expect(telemetry.spans).toHaveLength(0);
});

it('reports an install from the launch after it', () => {
  reportNativeUpdate({
    ...report({
      kind: 'install_failed',
      from_version: '2026.1106.1',
      target_version: '2026.1119.1',
      trigger: 'restart',
      failure: { kind: 'io', io_kind: 'PermissionDenied', http_status: null },
    }),
    durationMs: 0,
    bundleLocation: 'translocated',
  });
  const [install] = telemetry.spans;
  expect(install?.name).toBe('native.update.install');
  expect(install?.end).toHaveBeenCalledWith(1_000);
  expect(install?.error).toHaveBeenCalledWith(
    'native update install_failed: io'
  );
  expect(telemetry.track).toHaveBeenCalledWith(
    NATIVE_UPDATE_EVENT,
    expect.objectContaining({
      native_update_trigger: 'restart',
      native_update_from_version: '2026.1106.1',
      native_update_io_kind: 'PermissionDenied',
      native_update_bundle_location: 'translocated',
    })
  );
});

it('keeps up-to-date checks free of version targets and failures', () => {
  expect(
    nativeUpdateAttributes({
      ...report({ kind: 'up_to_date' }),
      bundleLocation: null,
    })
  ).toEqual({
    native_update_outcome: 'up_to_date',
    native_update_current_version: '2026.1106.1',
    native_update_bundle_location: undefined,
    native_update_started_at_ms: 1_000,
    native_update_duration_ms: 500,
  });
});

it('reports an update this OS cannot run as a check with its minimum', () => {
  reportNativeUpdate(
    report({
      kind: 'needs_newer_os',
      target_version: '2026.1119.1',
      minimum_system_version: '14.0',
    })
  );
  const [check] = telemetry.spans;
  expect(telemetry.spans).toHaveLength(1);
  expect(check?.name).toBe('native.update.check');
  expect(check?.error).not.toHaveBeenCalled();
  expect(check?.end).toHaveBeenCalledWith(1_500);
  expect(telemetry.track).toHaveBeenCalledWith(
    NATIVE_UPDATE_EVENT,
    expect.objectContaining({
      native_update_outcome: 'needs_newer_os',
      native_update_target_version: '2026.1119.1',
      native_update_minimum_system_version: '14.0',
    })
  );
});
