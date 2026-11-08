import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { dispatchApplicationCommand } from '../group-b/command';

export type NativeBlockKind =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'quote'
  | 'code'
  | 'custom-code'
  | 'link'
  | 'list-bullet'
  | 'list-number'
  | 'list-check';

/** Toolbar and menu callers submit policy without walking the mirrored tree. */
export function transformNativeBlock(view: EditorView, kind: NativeBlockKind) {
  return dispatchApplicationCommand(view, 'group-b.node-transform', kind);
}
