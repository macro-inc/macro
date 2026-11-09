import { type AuditTrace, type WindowMetrics, windowMetrics } from './metrics';
import { validateTrace } from './validate';

export interface FixtureMeasurements {
  readonly fixtureId: string;
  readonly nodeCount: number;
  readonly trace: AuditTrace;
  readonly captures: {
    readonly retainedCaptures: bigint;
    readonly liveNodes: bigint;
    readonly version: bigint;
    readonly retirementEpoch: bigint;
  };
  /** Collector evidence is separate from the four generated native fields. */
  readonly gcBarrier: {
    readonly version: bigint;
    readonly retirementEpoch: bigint;
    readonly finalizersCompleted: boolean;
    readonly nativePruneAcknowledged: boolean;
    readonly eventsRef: { readonly path: string; readonly sha256: string };
  };
}
export interface KeyComparison {
  readonly inputOperationHash: string;
  readonly smallWindowId: number;
  readonly largeWindowId: number;
}
export interface CounterGateResult {
  readonly pass: boolean;
  readonly failures: readonly string[];
  readonly windows: readonly {
    readonly fixtureId: string;
    readonly windowId: number;
    readonly metrics: WindowMetrics;
  }[];
}

/** Numeric gate only. Production route, plugin and build provenance are separate requirements. */
export function evaluateCounters(
  small: FixtureMeasurements,
  large: FixtureMeasurements,
  comparisons: readonly KeyComparison[]
): CounterGateResult {
  const failures: string[] = [];
  const windows: {
    fixtureId: string;
    windowId: number;
    metrics: WindowMetrics;
  }[] = [];
  for (const fixture of [small, large])
    failures.push(
      ...validateTrace(fixture.trace).map(
        (error) => `${fixture.fixtureId}: ${error}`
      )
    );
  if (failures.length > 0) return { pass: false, failures, windows };
  if (small.nodeCount !== 10 || large.nodeCount !== 10000)
    failures.push(
      'Counter fixtures must have exactly 10 and 10000 attached nodes'
    );
  for (const fixture of [small, large]) {
    const label = fixture.fixtureId;
    if (label.length === 0) failures.push('Missing fixture identity');
    const capture = fixture.captures;
    if (
      capture.version < 0n ||
      capture.retirementEpoch < 0n ||
      fixture.gcBarrier.version !== capture.version ||
      fixture.gcBarrier.retirementEpoch !== capture.retirementEpoch ||
      !fixture.gcBarrier.finalizersCompleted ||
      !fixture.gcBarrier.nativePruneAcknowledged ||
      fixture.gcBarrier.eventsRef.path.length === 0 ||
      !/^[0-9a-f]{64}$/.test(fixture.gcBarrier.eventsRef.sha256) ||
      capture.liveNodes !== BigInt(fixture.nodeCount) ||
      capture.retainedCaptures < 0n
    )
      failures.push(`${label}: incomplete native capture observation`);
    if (capture.retainedCaptures > 2n * capture.liveNodes)
      failures.push(`${label}: retained captures exceed twice live nodes`);
    for (const kind of ['update', 'read', 'keystroke']) {
      if (
        !fixture.trace.windows.some(
          (window) => window.kind === kind && window.phase === 'measurement'
        )
      )
        failures.push(`${label}: missing ${kind} samples`);
    }
    for (const window of fixture.trace.windows) {
      if (window.phase !== 'measurement') continue;
      const metrics = windowMetrics(fixture.trace, window.id);
      windows.push({ fixtureId: label, windowId: window.id, metrics });
      const at = `${label}/${window.label}`;
      if (!metrics.completed) failures.push(`${at}: incomplete sample`);
      if (window.kind === 'read' && metrics.apiCalls !== 0)
        failures.push(`${at}: read crossed the API boundary`);
      if (window.kind === 'update' && metrics.fixedApiCalls > 2)
        failures.push(`${at}: more than two fixed API calls`);
      if (
        window.kind === 'update' &&
        fixture.trace.calls.filter(
          (call) => call.windows.includes(window.id) && call.purpose === 'flush'
        ).length > 1
      )
        failures.push(`${at}: more than one synchronous flush`);
      if (window.kind === 'keystroke') {
        if (
          !fixture.trace.calls.some(
            (call) =>
              call.windows.includes(window.id) && call.purpose === 'admission'
          )
        )
          failures.push(`${at}: missing native admission receipt`);
        if (metrics.apiCalls > 10)
          failures.push(`${at}: more than ten API calls`);
        if (metrics.physicalCrossings > 4 * metrics.apiCalls)
          failures.push(
            `${at}: physical crossings exceed four times API calls`
          );
        if (metrics.bytes > 4096) failures.push(`${at}: bytes exceed 4096`);
        if (metrics.refSlots > 16)
          failures.push(`${at}: reference slots exceed 16`);
        if (metrics.apiCalls === 0 || metrics.physicalCrossings === 0)
          failures.push(`${at}: missing production boundary observations`);
      }
    }
    if (fixture.trace.calls.some((call) => !call.completed))
      failures.push(`${label}: failed boundary entry in raw trace`);
  }
  const smallIds = new Set<number>();
  const largeIds = new Set<number>();
  if (comparisons.length === 0) failures.push('Missing paired key samples');
  for (const comparison of comparisons) {
    if (!/^[0-9a-f]{64}$/.test(comparison.inputOperationHash))
      failures.push('Missing input operation hash');
    if (
      smallIds.has(comparison.smallWindowId) ||
      largeIds.has(comparison.largeWindowId)
    )
      failures.push('Key samples cannot be paired more than once');
    smallIds.add(comparison.smallWindowId);
    largeIds.add(comparison.largeWindowId);
    const smallWindow = small.trace.windows.find(
      (window) => window.id === comparison.smallWindowId
    );
    const largeWindow = large.trace.windows.find(
      (window) => window.id === comparison.largeWindowId
    );
    if (
      smallWindow?.kind !== 'keystroke' ||
      smallWindow.phase !== 'measurement' ||
      largeWindow?.kind !== 'keystroke' ||
      largeWindow.phase !== 'measurement'
    ) {
      failures.push('Comparison must identify two real key windows');
      continue;
    }
    const a = windowMetrics(small.trace, smallWindow.id);
    const b = windowMetrics(large.trace, largeWindow.id);
    // Multiplication preserves zero-baseline behavior and avoids division by zero.
    if (b.bytes * 10 > a.bytes * 11)
      failures.push('Key byte growth exceeds ten percent');
    if (b.physicalCrossings * 10 > a.physicalCrossings * 11)
      failures.push('Key physical crossing growth exceeds ten percent');
    if (b.refSlots * 10 > a.refSlots * 11)
      failures.push('Key reference slot growth exceeds ten percent');
  }
  for (const [fixture, ids] of [
    [small, smallIds],
    [large, largeIds],
  ] satisfies readonly (readonly [
    FixtureMeasurements,
    ReadonlySet<number>,
  ])[]) {
    if (
      fixture.trace.windows.some(
        (window) => window.kind === 'keystroke' && !ids.has(window.id)
      )
    )
      failures.push(`${fixture.fixtureId}: unpaired key sample`);
  }
  return Object.freeze({
    pass: failures.length === 0,
    failures: Object.freeze(failures),
    windows: Object.freeze(windows),
  });
}
