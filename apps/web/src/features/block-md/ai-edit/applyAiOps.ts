import { Doc } from '@ai-ops/doc';
import type { DocumentOp } from '@ai-ops/editor';
import type { NodeIdMappings } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import { $setSelection, type LexicalEditor } from 'lexical';

export function applyAiOps(
  editor: LexicalEditor,
  mapping: NodeIdMappings,
  ops: DocumentOp[]
): void {
  // The user's selection is usually inside the nodes about to change (they
  // selected them to ask for the edit). Lexical re-resolves that selection
  // after every update, and offsets from the old text overrun the new one:
  // `$getTextNodeOffset: invalid offset 77 for size 61`. Drop it first; the
  // popup that triggered the edit has already closed.
  editor.update(() => $setSelection(null), { discrete: true });
  const doc = new Doc({ editor, ids: mapping });
  for (const op of ops) {
    doc.apply(op);
  }
}
