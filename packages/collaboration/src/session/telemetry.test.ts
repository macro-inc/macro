import type { Attribute, Attributes, Span } from '@macro-inc/observability';
import { expect, test } from 'vitest';
import { TelemetryMsg } from './abi.generated';
import { SessionTelemetry } from './telemetry';

class RecordedSpan implements Span {
  readonly children: RecordedSpan[] = [];
  readonly attrs = new Map<string, Attribute>();
  ends = 0;
  constructor(readonly name: string) {}
  span<T>(name: string, operation: (span: Span) => Promise<T>): Promise<T>;
  span(name: string): Span;
  span<T>(
    name: string,
    operation?: (span: Span) => Promise<T>
  ): Span | Promise<T> {
    const child = new RecordedSpan(name);
    this.children.push(child);
    return operation ? operation(child).finally(() => child.end()) : child;
  }
  run<T>(operation: () => T): T {
    return operation();
  }
  setAttr(key: string, value: Attribute): void {
    this.attrs.set(key, value);
  }
  event(_name: string, _attributes?: Attributes): void {}
  error(_error: unknown): void {}
  traceparent(): undefined {}
  injectTraceHeaders(_headers: Record<string, string>): void {}
  end(): void {
    this.ends++;
  }
}

function snapshotCounts(telemetry: SessionTelemetry, current: bigint) {
  telemetry.forward(
    TelemetryMsg.decode(
      TelemetryMsg.encode({
        span: 7n,
        parent: 0n,
        kind: 1,
        name: 'doc.snapshot.export',
        outcome: '',
        error: false,
        attrs: [
          {
            key: 'snapshot.current_ops',
            kind: 1,
            unsigned: current,
            signed: 0n,
            text: '',
            flag: false,
          },
        ],
      })
    )
  );
}

test('a synchronous native tick and its later snapshot share only their explicit sequence', () => {
  const root = new RecordedSpan('root');
  const telemetry = new SessionTelemetry(root);
  telemetry.identify('synthetic-document', 'synthetic-session');
  const value = telemetry.tick(42, (span) => {
    span.setAttr('native.tick.duration_ms', 120);
    return 17;
  });
  expect(value).toBe(17);
  const tick = root.children[0];
  expect(tick.name).toBe('doc.sync.tick');
  expect(tick.attrs.get('native.tick.duration_ms')).toBe(120);
  expect(tick.attrs.get('snapshot.sequence')).toBe(42);
  expect(tick.attrs.get('document.id')).toBe('synthetic-document');
  expect(tick.ends).toBe(1);
  telemetry.forward(
    {
      span: 7n,
      parent: 0n,
      kind: 0,
      name: 'doc.snapshot.save',
      outcome: '',
      error: false,
      attrs: [],
    },
    42
  );
  snapshotCounts(telemetry, 123n);
  const snapshot = root.children[1];
  expect(snapshot.attrs.get('snapshot.sequence')).toBe(42);
  expect(snapshot.attrs.get('document.id')).toBe('synthetic-document');
  expect(snapshot.attrs.get('snapshot.current_ops')).toBe(123);
  snapshotCounts(telemetry, 456n);
  expect(tick.attrs.has('snapshot.current_ops')).toBe(false);
});

test.each([undefined, null, { opaque: true }])(
  'tick closes and releases its observation on an opaque failure: %j',
  (cause) => {
    const root = new RecordedSpan('root');
    const telemetry = new SessionTelemetry(root);
    let caught = false;
    try {
      telemetry.tick(42, () => {
        throw cause;
      });
    } catch (error) {
      caught = true;
      expect(error).toBe(cause);
    }
    expect(caught).toBe(true);
    const tick = root.children[0];
    expect(tick.ends).toBe(1);
    snapshotCounts(telemetry, 456n);
    expect(tick.attrs.has('snapshot.current_ops')).toBe(false);
  }
);
