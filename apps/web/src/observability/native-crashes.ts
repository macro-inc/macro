import { analytics } from '@app/lib/analytics';
import { isDesktopPlatform } from '@core/util/platform';
import { sleep } from '@core/util/sleep';
import { invoke } from '@tauri-apps/api/core';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type {
  CrashReport,
  NativeCrash,
  PanicCrash,
} from './generated/native-crashes';

/**
 * How long a sent report stays on disk. PostHog sends without waiting for an
 * answer, so the ack is a guess that delivery went through: a crash or quit
 * within this window resends the report at the next start, and the event's
 * fixed uuid and timestamp let PostHog drop the copy. A PostHog outage that
 * lasts past the window may lose the report: posthog-js retries only in
 * memory, while this webview stays open.
 */
const ACK_DELAY_MS = 15_000;

/**
 * Sends the desktop app's native crashes to PostHog as `$exception`: Rust
 * panics and, in the Chromium build, a signature of each crash dump. The
 * native app keeps them on disk until they are acked here; see
 * `tauri/src-tauri/README.md#native-crash-reports`.
 */
export async function reportNativeCrashes(): Promise<void> {
  // Without PostHog (dev builds), leave them for a build that can send them.
  if (!isDesktopPlatform() || !analytics.posthog.__loaded) return;
  // Binaries from before crash reporting lack the command.
  const reports = await ResultAsync.fromPromise(
    invoke<CrashReport[]>('take_native_crash_reports'),
    () => undefined
  );
  if (reports.isErr()) return;
  // A report PostHog dropped (a private call page) waits for the next start.
  const sent = reports.value.filter(sendReport).map((report) => report.id);
  if (sent.length === 0) return;
  await sleep(ACK_DELAY_MS);
  await invoke('ack_native_crash_reports', { ids: sent });
}

function sendReport(report: CrashReport): boolean {
  const properties = exceptionProperties(report);
  if (!properties) return false;
  const result = analytics.posthog.capture('$exception', properties, {
    // Both ids end in a UUID (`panic-<uuid>`, `minidump-<crashpad uuid>`).
    uuid: report.id.slice(report.id.indexOf('-') + 1),
    timestamp: new Date(report.timestampMs),
    send_instantly: true,
  });
  return result !== undefined;
}

/**
 * The PostHog `$exception` properties for one native crash; undefined for a
 * kind this bundle doesn't know (from a newer native build).
 */
export function exceptionProperties(report: CrashReport) {
  const common = {
    native_crash_id: report.id,
    native_crash_kind: report.crash.kind,
    native_crash_timestamp_ms: report.timestampMs,
    // The build that crashed, which may be older than the one reporting it.
    native_crash_version: report.launch?.nativeVersion,
    native_crash_build_time_ms: report.launch?.nativeBuildTimeMs,
    native_crash_os: report.os,
    native_crash_os_version: report.osVersion ?? undefined,
    native_crash_arch: report.arch ?? undefined,
  };
  return match(report.crash)
    .with({ kind: 'panic' }, (crash) => ({
      ...common,
      ...panicProperties(crash),
    }))
    .with({ kind: 'native' }, (crash) => ({
      ...common,
      ...nativeProperties(crash, report),
    }))
    .exhaustive(() => undefined);
}

function panicProperties(crash: PanicCrash) {
  return {
    native_crash_process_type: 'main',
    native_crash_thread: crash.thread ?? undefined,
    native_crash_location: crash.location ?? undefined,
    // The process survives a panic on another thread (a task's `JoinError`).
    $exception_level: crash.thread === 'main' ? 'fatal' : 'error',
    $exception_list: [
      {
        type: 'Panic',
        value: crash.message,
        mechanism: { type: 'panic', handled: false, synthetic: false },
        stacktrace: {
          type: 'raw',
          // PostHog lists frames outermost first.
          frames: [...crash.frames].reverse().map((frame) => ({
            platform: 'native',
            lang: 'rust',
            function: frame.function,
            filename: frame.file ?? undefined,
            lineno: frame.line ?? undefined,
            in_app: frame.inApp,
            synthetic: false,
            client_resolved: true,
          })),
        },
      },
    ],
  };
}

function nativeProperties(crash: NativeCrash, report: CrashReport) {
  const module = crash.module;
  const where = module
    ? `${module.name}+${module.offset}`
    : 'an unknown module';
  return {
    native_crash_process_type: crash.processType,
    native_crash_exception: crash.exception,
    native_crash_module: module?.name,
    native_crash_module_offset: module?.offset,
    native_crash_module_debug_id: module?.debugId ?? undefined,
    // Chromium's `DumpWithoutCrashing` reports a problem the process survived.
    $exception_level: crash.dumpedWithoutCrashing ? 'error' : 'fatal',
    // Without uploaded symbols the frame cannot be resolved, so group on where
    // the process died instead.
    $exception_fingerprint: [
      'native',
      crash.processType,
      crash.exception,
      where,
    ].join(':'),
    $exception_list: [
      {
        type: crash.exception,
        value: `${crash.processType} process crashed in ${where}`,
        mechanism: { type: 'minidump', handled: false, synthetic: false },
        stacktrace: crash.instructionAddress
          ? {
              type: 'raw',
              frames: [
                {
                  platform: 'native',
                  instruction_addr: crash.instructionAddress,
                  image_addr: module?.baseAddress,
                  module: module?.name,
                  function: module ? where : undefined,
                  in_app: false,
                  synthetic: false,
                  client_resolved: false,
                },
              ],
            }
          : undefined,
      },
    ],
    // Lets PostHog symbolicate the frame if symbols for this build are uploaded.
    $debug_images:
      module?.debugId != null
        ? [
            {
              type: report.os === 'macos' ? 'macho' : 'elf',
              debug_id: module.debugId,
              code_id: module.codeId ?? undefined,
              code_file: module.name,
              image_addr: module.baseAddress,
              image_size: module.size,
              arch: report.arch ?? undefined,
            },
          ]
        : undefined,
  };
}
