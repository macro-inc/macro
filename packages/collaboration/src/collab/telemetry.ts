import {
  type Attribute,
  type Attributes,
  type Span,
  Telemetry,
} from '@macro-inc/observability';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type DocumentTelemetry = {
  attributes: Attributes;
};

const documents = new Map<string, DocumentTelemetry>();

function documentTelemetry(documentId: string): DocumentTelemetry {
  let value = documents.get(documentId);
  if (!value) {
    value = {
      attributes: {
        'document.id': documentId,
        'session.id': crypto.randomUUID(),
      },
    };
    documents.set(documentId, value);
  }
  return value;
}

type SpanOperation<T> = (span: Span) => Promise<T>;

function setDocumentSpanAttributes(documentId: string, span: Span): void {
  for (const [key, value] of Object.entries(
    documentTelemetry(documentId).attributes
  )) {
    if (value !== undefined) span.setAttr(key, value);
  }
}

// The span-returning overload comes first: with strictNullChecks off
// (ai-editing-worker), `undefined` would otherwise match the async one.
export function telemetrySpan(
  documentId: string,
  name: string,
  operation?: undefined,
  parentSpan?: Span
): Span;
export function telemetrySpan<T>(
  documentId: string,
  name: string,
  operation: SpanOperation<T>,
  parentSpan?: Span
): Promise<T>;
export function telemetrySpan<T>(
  documentId: string,
  name: string,
  operation?: SpanOperation<T>,
  parentSpan?: Span
): Span | Promise<T> {
  const tracer = parentSpan ?? Telemetry;
  if (operation) {
    return tracer.span(name, async (span) => {
      setDocumentSpanAttributes(documentId, span);
      return operation(span);
    });
  }

  const span = tracer.span(name);
  setDocumentSpanAttributes(documentId, span);
  return span;
}

export function setTelemetryAttr(
  documentId: string,
  name: string,
  value: Attribute
): void {
  documentTelemetry(documentId).attributes[name] = value;
}

export function logTelemetry(
  documentId: string,
  level: LogLevel,
  message: string,
  attributes?: Attributes
): void {
  Telemetry[level](message, {
    ...documentTelemetry(documentId).attributes,
    ...attributes,
  });
}

export function disposeTelemetryFor(documentId: string): void {
  documents.delete(documentId);
}

const HEALTH_SAMPLE_RATE = 0.05;
const MAX_SNAPSHOT_SAMPLES = 4;
const SNAPSHOT_SAMPLE_SPACING_MS = 60_000;

type SnapshotExportOutcome = 'exported' | 'failed';

function recordHealthSample(
  name: 'collab.snapshot.export' | 'collab.engine.window',
  attributes: Attributes
): void {
  try {
    Telemetry.recordAnonymousSample(name, attributes);
  } catch {
    // Telemetry is best effort and must not affect collaboration.
  }
}

function exportDurationBucket(ms: number): string {
  if (ms < 10) return 'under_10ms';
  if (ms < 50) return '10_to_49ms';
  if (ms < 250) return '50_to_249ms';
  if (ms < 1000) return '250_to_999ms';
  return '1s_or_more';
}

function engineDurationBucket(ms: number): string {
  if (ms < 10_000) return 'under_10s';
  if (ms < 60_000) return '10_to_59s';
  if (ms < 600_000) return '1_to_9min';
  if (ms < 3_600_000) return '10_to_59min';
  return '1h_or_more';
}

function batchRateBucket(batches: number, elapsedMs: number): string {
  if (batches === 0) return 'none';
  const perMinute = (batches * 60_000) / Math.max(elapsedMs, 1);
  if (perMinute < 1) return 'under_1';
  if (perMinute < 10) return '1_to_9';
  if (perMinute < 60) return '10_to_59';
  return '60_or_more';
}

function transitionCountBucket(count: number): string {
  if (count === 0) return 'none';
  if (count === 1) return 'one';
  return 'two_or_more';
}

/** One identity-free observation window per sampled engine. */
export class CollaborationHealthTelemetry {
  static sample(): CollaborationHealthTelemetry | undefined {
    if (Math.random() < HEALTH_SAMPLE_RATE) {
      return new CollaborationHealthTelemetry();
    }
  }

  private startedAt?: number;
  private finished = false;
  private localBatches = 0;
  private reconnects = 0;
  private resets = 0;
  private snapshotSamples = 0;
  private nextSnapshotSampleAt = 0;

  private constructor() {}

  start(): void {
    this.startedAt ??= performance.now();
  }

  localBatch(): void {
    if (!this.finished) this.localBatches++;
  }

  reconnect(): void {
    if (!this.finished) this.reconnects++;
  }

  reset(): void {
    if (!this.finished) this.resets++;
  }

  beginSnapshotExport(): number | undefined {
    if (this.finished || this.snapshotSamples >= MAX_SNAPSHOT_SAMPLES) return;

    const now = performance.now();
    if (now < this.nextSnapshotSampleAt) return;

    this.snapshotSamples++;
    this.nextSnapshotSampleAt = now + SNAPSHOT_SAMPLE_SPACING_MS;
    return now;
  }

  endSnapshotExport(startedAt: number, outcome: SnapshotExportOutcome): void {
    recordHealthSample('collab.snapshot.export', {
      'collab.snapshot.export.outcome': outcome,
      'collab.snapshot.export.elapsed_bucket': exportDurationBucket(
        performance.now() - startedAt
      ),
      'collab.engine.sample_rate': HEALTH_SAMPLE_RATE,
    });
  }

  finish(): void {
    if (this.startedAt === undefined || this.finished) return;

    this.finished = true;
    const elapsedMs = performance.now() - this.startedAt;
    recordHealthSample('collab.engine.window', {
      'collab.engine.elapsed_bucket': engineDurationBucket(elapsedMs),
      'collab.engine.local_batches_per_minute_bucket': batchRateBucket(
        this.localBatches,
        elapsedMs
      ),
      'collab.engine.reconnect_count_bucket': transitionCountBucket(
        this.reconnects
      ),
      'collab.engine.reset_count_bucket': transitionCountBucket(this.resets),
      'collab.engine.sample_rate': HEALTH_SAMPLE_RATE,
    });
  }
}

function cappedAttr(value: string, max = 256): string {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

/** `peer:counter` pairs as one compact span attribute. */
export function peerCounterAttr(
  pairs: Iterable<[peer: string, counter: number]>
): string {
  return cappedAttr(
    [...pairs].map(([peer, counter]) => `${peer}:${counter}`).join(',')
  );
}

/** A doc version as a compact span attribute (its frontiers). */
export function frontiersAttr(doc: {
  frontiers(): { peer: string; counter: number }[];
}): string {
  return peerCounterAttr(doc.frontiers().map((f) => [f.peer, f.counter]));
}
