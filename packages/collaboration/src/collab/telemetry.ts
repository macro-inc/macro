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

export function telemetrySpan<T>(
  documentId: string,
  name: string,
  operation: SpanOperation<T>
): Promise<T>;
export function telemetrySpan(documentId: string, name: string): Span;
export function telemetrySpan<T>(
  documentId: string,
  name: string,
  operation?: SpanOperation<T>
): Span | Promise<T> {
  if (operation) {
    return Telemetry.span(name, async (span) => {
      setDocumentSpanAttributes(documentId, span);
      return operation(span);
    });
  }

  const span = Telemetry.span(name);
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
