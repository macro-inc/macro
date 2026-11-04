import type { Span } from '@macro-inc/observability';
import type { LoroDoc } from 'loro-crdt';

export function stampLoroSnapshotState(span: Span, doc: LoroDoc): void {
  const version = doc.oplogVersion();

  span.setAttr('snapshot.op_count', doc.opCount());
  span.setAttr('snapshot.peer_count', version.length());
  span.setAttr('snapshot.frontier_count', doc.oplogFrontiers().length);
  span.setAttr('snapshot.is_shallow', doc.isShallow());
}
