import {
  editorStateAsMarkdown,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { createCallback } from '@solid-primitives/rootless';
import { useMarkdownDocument } from '../context/markdown-document-context';

export function useDownloadDocumentAsMarkdownText() {
  const { persistedName, fallbackName, state } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = state.editor.md.editor;
    if (editor === undefined) return;

    const fileNameWithExtension = `${fileName()}.md`;
    const markdownString = editorStateAsMarkdown(editor, 'external');

    const blob = new Blob([markdownString], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameWithExtension;
    link.click();
    URL.revokeObjectURL(url);
  });
}

export function useDownloadDocumentAsJson() {
  const { persistedName, fallbackName, state } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = state.editor.md.editor;
    if (!editor) {
      return;
    }
    const fileNameWithExtension = `${fileName()}.json`;
    const json = getSaveState(editor.getEditorState());
    const blob = new Blob([JSON.stringify(json, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileNameWithExtension;
    link.click();
    URL.revokeObjectURL(url);
  });
}
