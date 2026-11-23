import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrashReport } from './generated/native-crashes';
import { exceptionProperties, reportNativeCrashes } from './native-crashes';

const mocks = vi.hoisted(() => ({
  posthog: { __loaded: true, capture: vi.fn() },
  invoke: vi.fn(),
}));
vi.mock('@app/lib/analytics', () => ({
  analytics: { posthog: mocks.posthog },
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@core/util/platform', () => ({ isDesktopPlatform: () => true }));

const LAUNCH = {
  startedAtMs: 1,
  nativeVersion: '2026.1120.3',
  nativeBuildTimeMs: 2,
};

const PANIC: CrashReport = {
  id: 'panic-1',
  timestampMs: 10,
  launch: LAUNCH,
  os: 'linux',
  osVersion: '6.12.0',
  arch: 'x86_64',
  crash: {
    kind: 'panic',
    thread: 'tokio-runtime-worker',
    message: 'called `Option::unwrap()` on a `None` value',
    location: 'src/lib.rs:3:9',
    frames: [
      { function: 'app_lib::inner', file: null, line: null, inApp: true },
      { function: 'app_lib::outer', file: 'src/lib.rs', line: 9, inApp: true },
    ],
  },
};

const MINIDUMP: CrashReport = {
  id: 'minidump-1',
  timestampMs: 20,
  launch: null,
  os: 'macos',
  osVersion: '15.1.0 (24B83)',
  arch: 'aarch64',
  crash: {
    kind: 'native',
    processType: 'renderer',
    exception: 'EXC_BAD_ACCESS / KERN_INVALID_ADDRESS',
    dumpedWithoutCrashing: false,
    instructionAddress: '0x100004321',
    module: {
      name: 'Chromium Embedded Framework',
      debugId: 'aabbccdd-eeff-0011-2233-445566778899',
      codeId: null,
      baseAddress: '0x100000000',
      size: 1048576,
      offset: '0x4321',
    },
  },
};

afterEach(() => {
  vi.clearAllMocks();
  mocks.posthog.__loaded = true;
});

describe('exceptionProperties', () => {
  it('sends a panic with its frames outermost first and the build that crashed', () => {
    expect(exceptionProperties(PANIC)).toMatchObject({
      native_crash_kind: 'panic',
      native_crash_version: '2026.1120.3',
      native_crash_process_type: 'main',
      native_crash_location: 'src/lib.rs:3:9',
      $exception_level: 'fatal',
      $exception_list: [
        {
          type: 'Panic',
          value: 'called `Option::unwrap()` on a `None` value',
          mechanism: { type: 'panic', handled: false },
          stacktrace: {
            type: 'raw',
            frames: [
              {
                platform: 'native',
                lang: 'rust',
                function: 'app_lib::outer',
                filename: 'src/lib.rs',
                lineno: 9,
                in_app: true,
              },
              { platform: 'native', function: 'app_lib::inner' },
            ],
          },
        },
      ],
    });
  });

  it('sends a crash dump as its signature, grouped by where it died', () => {
    expect(exceptionProperties(MINIDUMP)).toMatchObject({
      native_crash_kind: 'native',
      native_crash_version: undefined,
      native_crash_process_type: 'renderer',
      native_crash_module: 'Chromium Embedded Framework',
      native_crash_module_offset: '0x4321',
      $exception_fingerprint:
        'native:renderer:EXC_BAD_ACCESS / KERN_INVALID_ADDRESS:Chromium Embedded Framework+0x4321',
      $exception_list: [
        {
          type: 'EXC_BAD_ACCESS / KERN_INVALID_ADDRESS',
          value:
            'renderer process crashed in Chromium Embedded Framework+0x4321',
          stacktrace: {
            frames: [
              {
                platform: 'native',
                instruction_addr: '0x100004321',
                image_addr: '0x100000000',
              },
            ],
          },
        },
      ],
      $debug_images: [
        {
          type: 'macho',
          debug_id: 'aabbccdd-eeff-0011-2233-445566778899',
          image_addr: '0x100000000',
          image_size: 1048576,
        },
      ],
    });
  });

  it('sends a dump it could not read without frames', () => {
    const properties = exceptionProperties({
      ...MINIDUMP,
      crash: {
        ...MINIDUMP.crash,
        kind: 'native',
        processType: 'unknown',
        exception: 'unreadable minidump',
        dumpedWithoutCrashing: false,
        instructionAddress: null,
        module: null,
      },
    });
    expect(properties.$exception_list[0].stacktrace).toBeUndefined();
    expect(properties).toMatchObject({ $debug_images: undefined });
  });
});

describe('reportNativeCrashes', () => {
  it('acks only the reports PostHog accepted', async () => {
    mocks.invoke.mockResolvedValueOnce([PANIC, MINIDUMP]);
    mocks.posthog.capture
      .mockReturnValueOnce({ uuid: 'sent' })
      .mockReturnValueOnce(undefined);
    await reportNativeCrashes();
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      1,
      'take_native_crash_reports'
    );
    expect(mocks.invoke).toHaveBeenNthCalledWith(
      2,
      'ack_native_crash_reports',
      {
        ids: ['panic-1'],
      }
    );
  });

  it('leaves reports on disk while PostHog is not running', async () => {
    mocks.posthog.__loaded = false;
    await reportNativeCrashes();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it('does nothing on a binary without crash reports', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('unknown command'));
    await reportNativeCrashes();
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.posthog.capture).not.toHaveBeenCalled();
  });
});
