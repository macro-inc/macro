import { analytics } from '@app/lib/analytics';
import { type Attributes, Telemetry } from '@macro-inc/observability';
import { match } from 'ts-pattern';
import type { Failure, Outcome, Report } from './generated/native-update';

/** The PostHog event every native update report becomes. */
export const NATIVE_UPDATE_EVENT = 'native_update_outcome';

function failureAttributes(failure: Failure): Attributes {
  return {
    native_update_failure_kind: failure.kind,
    native_update_io_kind: failure.io_kind ?? undefined,
    native_update_http_status: failure.http_status ?? undefined,
  };
}

function outcomeAttributes(outcome: Outcome): Attributes {
  return match(outcome)
    .with({ kind: 'up_to_date' }, () => ({}))
    .with({ kind: 'update_found' }, (found) => ({
      native_update_target_version: found.target_version,
    }))
    .with({ kind: 'downloaded' }, (downloaded) => ({
      native_update_target_version: downloaded.target_version,
      native_update_download_ms: downloaded.download_ms,
      native_update_download_bytes: downloaded.download_bytes,
      native_update_resumed_bytes: downloaded.resumed_bytes,
    }))
    .with({ kind: 'check_failed' }, (failed) => ({
      ...failureAttributes(failed.failure),
      native_update_consecutive_failures: failed.consecutive_failures,
    }))
    .with({ kind: 'download_failed' }, (failed) => ({
      native_update_target_version: failed.target_version,
      native_update_download_ms: failed.download_ms,
      ...failureAttributes(failed.failure),
      native_update_consecutive_failures: failed.consecutive_failures,
    }))
    .with({ kind: 'installed' }, (installed) => ({
      native_update_from_version: installed.from_version,
      native_update_target_version: installed.target_version,
      native_update_trigger: installed.trigger,
    }))
    .with({ kind: 'install_failed' }, (failed) => ({
      native_update_from_version: failed.from_version,
      native_update_target_version: failed.target_version,
      native_update_trigger: failed.trigger,
      ...failureAttributes(failed.failure),
    }))
    .exhaustive(() => ({}));
}

/** Flat attributes shared by the PostHog event and the span. */
export function nativeUpdateAttributes(report: Report): Attributes {
  return {
    native_update_outcome: report.outcome.kind,
    native_update_current_version: report.currentVersion,
    native_update_bundle_location: report.bundleLocation ?? undefined,
    native_update_started_at_ms: report.startedAtMs,
    native_update_duration_ms: report.durationMs,
    ...outcomeAttributes(report.outcome),
  };
}

/**
 * Which span a report becomes; checks keep their measured duration. A found
 * update has none: the same check reports again when its download ends, and
 * that span covers the whole check.
 */
function spanName(outcome: Outcome): string | undefined {
  return match(outcome.kind)
    .with('installed', 'install_failed', () => 'native.update.install')
    .with('update_found', () => undefined)
    .otherwise(() => 'native.update.check');
}

function downloadMs(outcome: Outcome): number | undefined {
  return match(outcome)
    .with(
      { kind: 'downloaded' },
      { kind: 'download_failed' },
      (value) => value.download_ms
    )
    .otherwise(() => undefined);
}

function failed(outcome: Outcome): string | undefined {
  return match(outcome)
    .with(
      { kind: 'check_failed' },
      { kind: 'download_failed' },
      { kind: 'install_failed' },
      (value) => `native update ${value.kind}: ${value.failure.kind}`
    )
    .otherwise(() => undefined);
}

/**
 * Sends one native update check or install outcome to PostHog and as a span
 * timed by the host. Installs are reported by the launch after them, so their
 * span marks when the install began.
 */
export function reportNativeUpdate(report: Report) {
  const attributes = nativeUpdateAttributes(report);
  analytics.track(NATIVE_UPDATE_EVENT, attributes);
  const name = spanName(report.outcome);
  if (!name) return;
  // Unclassed: an update failure must reach us for every user, not a sample.
  const span = Telemetry.span(name, {
    startTime: report.startedAtMs,
    attributes,
  });
  const end = report.startedAtMs + report.durationMs;
  const download = downloadMs(report.outcome);
  const failure = failed(report.outcome);
  if (download !== undefined) {
    const child = span.run(() =>
      Telemetry.span('native.update.download', { startTime: end - download })
    );
    if (report.outcome.kind === 'download_failed' && failure)
      child.error(failure);
    child.end(end);
  }
  if (failure) span.error(failure);
  span.end(end);
}
