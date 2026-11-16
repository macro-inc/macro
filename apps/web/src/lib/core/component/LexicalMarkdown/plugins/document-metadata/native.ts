import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { MarkdownEditorErrors } from '../../constants';

/** Source notifies from its RootNode transform, not from snapshot installation. */
export function registerNativeDocumentMetadata(
  view: EditorView,
  onVersionError?: (error: MarkdownEditorErrors) => void
): () => void {
  return view.onPluginEvent('group-b.document-version-error', () =>
    onVersionError?.(MarkdownEditorErrors.VERSION_MISMATCH_ERROR)
  );
}

/** The native load rejection uses the same closed error code as Source's initializer. */
export function nativeDocumentMetadataError(
  error: unknown
): MarkdownEditorErrors | undefined {
  if (
    error instanceof Error &&
    error.message === MarkdownEditorErrors.VERSION_MISMATCH_ERROR
  )
    return MarkdownEditorErrors.VERSION_MISMATCH_ERROR;
}
