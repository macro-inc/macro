import { getSaveState } from '@core/component/LexicalMarkdown/utils';
import type { LexicalEditor, SerializedEditorState } from 'lexical';

/** The live document as History's "current" version: Source getSaveState, or the native saved state. */
export function currentSavedState(md: {
  editor?: LexicalEditor;
  nativeRuntime?: { executor: { session: { savedState(): string } } };
}): SerializedEditorState | undefined {
  if (md.editor) return getSaveState(md.editor.getEditorState());
  const saved = md.nativeRuntime?.executor.session.savedState();
  if (saved === undefined) return undefined;
  const state: SerializedEditorState = JSON.parse(saved);
  return state;
}
