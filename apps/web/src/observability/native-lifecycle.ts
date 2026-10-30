import { analytics } from '@app/lib/analytics';
import { type Attributes, Telemetry } from '@macro-inc/observability';
import type { DesktopSnapshot } from './desktop';
import { frontendInstanceId } from './frontend-instance';
import {
  nativeDiagnosticsRetired,
  recoverableNativeFrontend,
} from './native-diagnostics';
import { consumeReloadIntent } from './reload';

/** Called once per document, including recovery after a WebContent termination. */
export function recordNativeWebviewStart(
  snapshot: DesktopSnapshot | undefined,
  documentLifecycle?: Attributes
) {
  const bundleBuild = document
    .querySelector('meta[name="macro-bundle-build"]')
    ?.getAttribute('content');
  const navigation = performance.getEntriesByType('navigation')[0];
  // Native snapshots include this field on every platform, but only the iOS
  // and macOS termination callbacks record it. Other platforms remain unknown.
  const webContent =
    snapshot?.identity.os === 'ios' || snapshot?.identity.os === 'macos'
      ? snapshot.webContent
      : undefined;
  const attributes = {
    frontend_instance_id: frontendInstanceId,
    native_instance_id: snapshot?.identity.instanceId,
    native_version: snapshot?.identity.nativeVersion,
    native_diagnostics_available: snapshot !== undefined,
    native_termination_reporting_available: webContent !== undefined,
    native_web_content_terminations: webContent?.terminations,
    native_last_termination_ms: webContent?.lastTerminationMs ?? undefined,
    native_bundle_reload_dispatches: snapshot?.bundleReloads?.dispatches,
    native_bundle_reload_last_source:
      snapshot?.bundleReloads?.lastSource ?? undefined,
    native_bundle_reload_last_id:
      snapshot?.bundleReloads?.lastReloadId ?? undefined,
    native_bundle_reload_last_dispatch_ms:
      snapshot?.bundleReloads?.lastDispatchMs ?? undefined,
    native_breadcrumbs_available: snapshot?.recentEvents !== undefined,
    native_memory_warning_reporting_available:
      snapshot?.recentEvents?.memoryWarningReporting ?? false,
    native_breadcrumbs_dropped: snapshot?.recentEvents?.dropped,
    loaded_bundle_build: bundleBuild ?? undefined,
    web_version: import.meta.env.__APP_VERSION__,
    navigation_type:
      navigation && 'type' in navigation && typeof navigation.type === 'string'
        ? navigation.type
        : 'unknown',
  };
  // Include the native launch and termination count on subsequent exceptions.
  // These are runtime identifiers, not account data.
  analytics.posthog.register(attributes);
  const startupAttributes = {
    ...attributes,
    ...documentLifecycle,
    ...consumeReloadIntent(),
    ...previousDocumentAttributes(snapshot, recoverableNativeFrontend()),
  };
  analytics.track('native_webview_started', startupAttributes);
  const span = Telemetry.span('native.webview.start');
  for (const [key, value] of Object.entries(startupAttributes)) {
    if (value !== undefined) span.setAttr(key, value);
  }
  span.end();
  if (snapshot && !nativeDiagnosticsRetired())
    reportRecoveredEvents(snapshot, recoverableNativeFrontend());
}

/** What the document this one replaced last opened, and its last memory warning. */
export function previousDocumentAttributes(
  snapshot: DesktopSnapshot | undefined,
  previousFrontend: string | undefined
) {
  const events =
    snapshot?.recentEvents?.events.filter(
      (entry) =>
        previousFrontend !== undefined &&
        entry.frontendInstanceId === previousFrontend
    ) ?? [];
  // Events are in sequence order; findLast is missing before iOS 15.4.
  const latest = (kind: string) =>
    [...events].reverse().find((entry) => entry.event.kind === kind);
  const navigation = latest('navigated');
  const breadcrumb =
    navigation?.event.kind === 'navigated' ? navigation.event : undefined;
  return {
    previous_document_last_route: breadcrumb?.route,
    previous_document_last_from_route: breadcrumb?.from_route ?? undefined,
    previous_document_last_entity_type: breadcrumb?.entity_type ?? undefined,
    previous_document_last_navigation_cause: breadcrumb?.cause,
    previous_document_last_navigation_at_ms: navigation?.timestampMs,
    previous_document_last_memory_warning_at_ms:
      latest('memory_warning')?.timestampMs,
  };
}

/** Recovered entries retain source identity/time; current signals identify their uploader. */
export function reportRecoveredEvents(
  snapshot: DesktopSnapshot,
  previousFrontend: string | undefined
) {
  const recent = snapshot.recentEvents;
  if (!recent || !previousFrontend) return;
  const key = 'macro-native-diagnostic-cursor';
  let after = 0;
  try {
    const saved = sessionStorage.getItem(key)?.split(':');
    if (saved?.[0] === snapshot.identity.instanceId) {
      const sequence = Number(saved[1]);
      if (Number.isSafeInteger(sequence) && sequence >= 0) after = sequence;
    }
  } catch {
    /* Recovery still works without session storage; duplicates retain event IDs. */
  }
  let latest = after;
  const entries = [
    ...recent.events,
    ...(recent.heartbeat ? [recent.heartbeat] : []),
  ].sort((a, b) => a.sequence - b.sequence);
  for (const entry of entries) {
    if (entry.frontendInstanceId !== previousFrontend) continue;
    if (entry.sequence <= after) continue;
    const attributes = {
      ...Object.fromEntries(
        Object.entries(entry.event).filter(([, value]) => value !== null)
      ),
      native_instance_id: snapshot.identity.instanceId,
      native_event_id: `${snapshot.identity.instanceId}:${entry.sequence}`,
      source_frontend_instance_id: entry.frontendInstanceId ?? undefined,
      recovered_by_frontend_instance_id: frontendInstanceId,
      native_event_timestamp_ms: entry.timestampMs,
      native_event_sequence: entry.sequence,
    };
    analytics.track('native_diagnostic_recovered', attributes);
    Telemetry.recordSample(
      'native.diagnostic.recovered',
      attributes,
      entry.timestampMs
    );
    latest = entry.sequence;
  }
  try {
    sessionStorage.setItem(key, `${snapshot.identity.instanceId}:${latest}`);
  } catch {
    /* Stable event IDs permit deduplication after storage loss. */
  }
}
