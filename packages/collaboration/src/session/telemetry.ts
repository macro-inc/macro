import { type Span, Telemetry } from '@macro-inc/observability';
import type { ITelemetryMsg } from './abi.generated';

/** Native span keys refer to host spans; no content or credentials are logged. */
export class SessionTelemetry {
  private readonly spans = new Map<bigint, Span>();
  private doc: string | undefined;
  constructor(private readonly root: Span) {}
  identify(doc: string, session: string): void {
    this.doc = doc;
    this.root.setAttr('document.id', doc);
    this.root.setAttr('session.id', session);
  }
  forward(record: ITelemetryMsg, tickSequence?: number): void {
    let span = this.spans.get(record.span);
    if (record.kind === 0) {
      span = (this.spans.get(record.parent) ?? this.root).span(record.name);
      this.spans.set(record.span, span);
      if (record.name === 'doc.snapshot.save') {
        if (this.doc !== undefined) span.setAttr('document.id', this.doc);
        if (tickSequence !== undefined)
          span.setAttr('snapshot.sequence', tickSequence);
      }
    }
    span ??= this.root;
    for (const attr of record.attrs) {
      let value: string | number | boolean;
      if (attr.kind === 0) value = attr.text;
      else if (attr.kind === 1 || attr.kind === 2) {
        const integer = attr.kind === 1 ? attr.unsigned : attr.signed;
        if (
          integer <= BigInt(Number.MAX_SAFE_INTEGER) &&
          integer >= BigInt(Number.MIN_SAFE_INTEGER)
        )
          value = Number(integer);
        else value = integer.toString();
      } else value = attr.flag;
      span.setAttr(attr.key, value);
      if (
        attr.key === 'outcome' &&
        typeof value === 'string' &&
        /fail|error/.test(value)
      )
        span.error(new Error(value));
    }
    if (record.kind === 1 && record.name) span.event(record.name);
    if (record.kind === 2) {
      const managed = this.spans.get(record.span);
      if (managed) {
        if (record.outcome) managed.setAttr('outcome', record.outcome);
        if (record.error) managed.error(new Error(record.outcome));
        managed.end();
        this.spans.delete(record.span);
      }
    }
  }
  /** Time only the actual native call; returned snapshot effects carry the same sequence. */
  tick(sequence: number, operation: (span: Span) => number): number {
    const span = this.root.span('doc.sync.tick');
    if (this.doc !== undefined) span.setAttr('document.id', this.doc);
    span.setAttr('snapshot.sequence', sequence);
    try {
      return span.run(() => operation(span));
    } finally {
      span.end();
    }
  }
  storage<T>(name: string, operation: () => Promise<T>): Promise<T> {
    return this.root.span(`doc.storage.${name}`, operation);
  }
  close(): void {
    for (const span of this.spans.values()) span.end();
    this.spans.clear();
  }
}
export const sessionTrace = () => Telemetry.span('doc.open');
