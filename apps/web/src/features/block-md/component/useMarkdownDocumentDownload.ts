import {
  editorStateAsMarkdown,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { toast } from '@core/component/Toast/Toast';
import { downloadFile } from '@filesystem/download';
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

    const blob = new Blob([markdownString], { type: 'text/markdown' });
    downloadFile(blob, fileNameWithExtension);
  });
}

export function useCopyDocumentAsMarkdown() {
  const { state } = useMarkdownDocument();

  return createCallback(async () => {
    const editor = state.editor.md.editor;
    if (!editor) return;

    try {
      await navigator.clipboard.writeText(
        editorStateAsMarkdown(editor, 'external')
      );
      toast.success('Markdown copied to clipboard');
    } catch (error) {
      console.error('Failed to copy markdown', error);
      toast.failure('Failed to copy markdown');
    }
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
    downloadFile(blob, fileNameWithExtension);
  });
}
