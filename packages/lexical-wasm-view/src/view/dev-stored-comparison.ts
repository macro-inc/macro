import type { EditorView } from './editor-view';

/** Preview/test-only STORED COMPARISON view; requires a dev-probes native seal. */
export function storedComparison(view: EditorView): string {
  return view.port.query({ kind: 10, key: 0, text: '', flags: 0 }).text;
}
