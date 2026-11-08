import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { MarkdownEditorErrors } from '../../constants';
import { MARKDOWN_VERSION_COUNTER } from '../../version';

/** Observe root state already delivered by Diff; no model query is necessary. */
export function registerNativeDocumentMetadata(
  view: EditorView,
  onVersionError?: (error: MarkdownEditorErrors) => void
): () => void {
  const check = () => {
    const root = view.node(0);
    if (!root || !onVersionError) return;
    const state: unknown = JSON.parse(root.stateJSON);
    if (!state || typeof state !== 'object' || !('documentMetadata' in state))
      return;
    const metadata = state.documentMetadata;
    if (!metadata || typeof metadata !== 'object' || !('version' in metadata))
      return;
    if (
      typeof metadata.version === 'number' &&
      metadata.version > MARKDOWN_VERSION_COUNTER
    )
      onVersionError(MarkdownEditorErrors.VERSION_MISMATCH_ERROR);
  };
  check();
  return view.onCommit((commit) => {
    if (commit.fullReconcile || commit.keys.includes(0)) check();
  });
}
