import { type Span, Telemetry } from '@macro-inc/observability';
import { beginInteraction } from './flow';
import type { UiOperationOutcome } from './ui-operation';

let started = false;

/**
 * Trace boot as an interaction that starts at navigation start; the first
 * view joins it, and it finishes at that view's paint opportunity. Call after
 * the provider and UI operation telemetry are registered, before rendering.
 */
export function startBootTrace(): void {
  if (started || typeof performance === 'undefined') return;
  started = true;
  beginInteraction('app.boot', {
    startTime: 0,
    closeOnJoin: true,
    onFinish: reconstructBoot,
  });
}

function interval(
  boot: Span,
  name: string,
  start: number,
  end: number,
  attributes?: Record<string, string | number>
): void {
  if (start < 0 || end <= start) return;
  const span = boot.run(() =>
    Telemetry.spanAt(name, performance.timeOrigin + start)
  );
  for (const [key, value] of Object.entries(attributes ?? {}))
    span.setAttr(key, value);
  span.end(performance.timeOrigin + end);
}

/** Reconstruct browser work once the first view reaches its paint opportunity. */
function reconstructBoot(
  boot: Span,
  outcome: UiOperationOutcome,
  end: number
): void {
  const navigation = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigation) {
    boot.setAttr('boot.navigation_type', navigation.type);
    interval(
      boot,
      'boot.dns',
      navigation.domainLookupStart,
      navigation.domainLookupEnd
    );
    interval(
      boot,
      'boot.connect',
      navigation.connectStart,
      navigation.connectEnd
    );
    if (navigation.secureConnectionStart > 0)
      interval(
        boot,
        'boot.tls',
        navigation.secureConnectionStart,
        navigation.connectEnd
      );
    interval(
      boot,
      'boot.request',
      navigation.requestStart,
      navigation.responseStart
    );
    interval(
      boot,
      'boot.response',
      navigation.responseStart,
      navigation.responseEnd
    );
    interval(
      boot,
      'boot.dom',
      navigation.responseEnd,
      navigation.domInteractive
    );
  }
  const refreshStarts = new Map<number, number>();
  for (const mark of performance.getEntriesByType('mark')) {
    if (mark.name.startsWith('macro.') && mark.startTime <= end) {
      boot.event(mark.name, undefined, performance.timeOrigin + mark.startTime);
      const detail = 'detail' in mark ? mark.detail : undefined;
      if (
        !detail ||
        typeof detail !== 'object' ||
        !('generation' in detail) ||
        typeof detail.generation !== 'number'
      )
        continue;
      if (mark.name === 'macro.auth.refresh-start') {
        refreshStarts.set(detail.generation, mark.startTime);
      } else if (mark.name === 'macro.auth.refresh-end') {
        const start = refreshStarts.get(detail.generation);
        // Provider registration may follow refresh; account resets can overlap
        // old and new attempts, so pair only marks from the same generation.
        if (start !== undefined)
          interval(boot, 'boot.auth.refresh', start, mark.startTime);
        refreshStarts.delete(detail.generation);
      }
    }
  }
  const resources = {
    script: {
      count: 0,
      encoded_bytes: 0,
      decoded_bytes: 0,
      transfer_bytes: 0,
      duration_ms: 0,
    },
    wasm: {
      count: 0,
      encoded_bytes: 0,
      decoded_bytes: 0,
      transfer_bytes: 0,
      duration_ms: 0,
    },
    font: {
      count: 0,
      encoded_bytes: 0,
      decoded_bytes: 0,
      transfer_bytes: 0,
      duration_ms: 0,
    },
  };
  for (const entry of performance.getEntriesByType('resource')) {
    const resource = entry as PerformanceResourceTiming;
    if (resource.responseEnd > end) continue;
    const path = new URL(resource.name, location.href).pathname;
    const kind = path.endsWith('.wasm')
      ? 'wasm'
      : /\.(woff2?|ttf|otf)$/.test(path)
        ? 'font'
        : path.endsWith('.js')
          ? 'script'
          : undefined;
    if (!kind) continue;
    const totals = resources[kind];
    totals.count++;
    totals.encoded_bytes += resource.encodedBodySize;
    totals.decoded_bytes += resource.decodedBodySize;
    totals.transfer_bytes += resource.transferSize;
    totals.duration_ms += resource.responseEnd - resource.startTime;
  }
  for (const [kind, totals] of Object.entries(resources)) {
    for (const [metric, value] of Object.entries(totals))
      boot.setAttr(`boot.resource.${kind}.${metric}`, value);
  }
  boot.setAttr('boot.outcome', outcome);
}
