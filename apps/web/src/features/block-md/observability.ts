import { type Span, Telemetry } from '@macro-inc/observability';
import type { LoroDoc } from 'loro-crdt';

const documentSpans = new Map<string, Span>();

export function startDocumentSpan(name: string): Span {
  return Telemetry.span(name);
}

export function registerDocumentSpan(documentId: string, span: Span): void {
  const previous = documentSpans.get(documentId);
  if (previous !== span) previous?.end();
  documentSpans.set(documentId, span);
}

export function resumeDocumentSpan(documentId: string): Span | undefined {
  return documentSpans.get(documentId);
}

export function endDocumentSpan(documentId: string): void {
  const span = documentSpans.get(documentId);
  if (!span) return;
  documentSpans.delete(documentId);
  span.end();
}

export function endTrackedDocumentSpan(span: Span): void {
  for (const [documentId, candidate] of documentSpans) {
    if (candidate === span) documentSpans.delete(documentId);
  }
  span.end();
}

export function stampLoroSnapshotState(span: Span, doc: LoroDoc): void {
  const version = doc.oplogVersion();

  span.setAttr('snapshot.op_count', doc.opCount());
  span.setAttr('snapshot.peer_count', version.length());
  span.setAttr('snapshot.frontier_count', doc.oplogFrontiers().length);
  span.setAttr('snapshot.is_shallow', doc.isShallow());
}
