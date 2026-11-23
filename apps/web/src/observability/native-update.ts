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
    }))
    .with({ kind: 'check_failed' }, (failed) => ({
      ...failureAttributes(failed.failure),
      native_update_consecutive_failures: failed.consecutive_failures,
    }))
    .with({ kind: 'download_failed' }, (failed) => ({
      native_update_target_version: failed.target_version,
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

/** Which span a report becomes; checks keep their measured duration. */
function spanName(outcome: Outcome): string {
  return match(outcome.kind)
    .with('installed', 'install_failed', () => 'native.update.install')
    .with('update_found', () => 'native.update.found')
    .otherwise(() => 'native.update.check');
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
  // Unclassed: an update failure must reach us for every user, not a sample.
  const span = Telemetry.span(spanName(report.outcome), {
    startTime: report.startedAtMs,
    attributes,
  });
  const end = report.startedAtMs + report.durationMs;
  const outcome = report.outcome;
  if (outcome.kind === 'downloaded') {
    const startTime = end - outcome.download_ms;
    span
      .run(() => Telemetry.span('native.update.download', { startTime }))
      .end(end);
  }
  const failure = failed(outcome);
  if (failure) span.error(failure);
  span.end(end);
}
