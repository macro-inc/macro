import { Doc } from '@ai-ops/doc';
import type { DocumentOp } from '@ai-ops/editor';
import type { NodeIdMappings } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import type { LexicalEditor } from 'lexical';

export function applyAiOps(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  ops: DocumentOp[]
): void {
  const doc = new Doc({ editor, ids: mapping });
  for (const op of ops) {
    doc.apply(op);
  }
}
