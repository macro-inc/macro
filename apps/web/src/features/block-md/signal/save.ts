import { useCommentState } from '@block-md/comments/commentStore';
import {
  editorStateAsMarkdown,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo } from 'solid-js';
import { useMarkdownDocument } from '../context/markdown-document-context';
import { useMdStore } from './markdownBlockData';

export const useBlockSave = () => {
  const { activeCommentThread } = useCommentState();
  const pendingComment = createMemo(() => activeCommentThread() === -1);

  return pendingComment;
};

export function useSaveMarkdownDocument() {
  const blockSave = useBlockSave();
  const saveDocument = useMarkdownDocument().saveDocument;

  return createCallback(async (text: string) => {
    if (blockSave()) return;
    await saveDocument(text);
  });
}

export function useRenameMarkdownDocument() {
  return useMarkdownDocument().renameDocument;
}

export function useDownloadDocumentAsMarkdownText() {
  const [store] = useMdStore();
  const { persistedName, fallbackName } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = store.editor;
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
  const [store] = useMdStore();
  const { persistedName, fallbackName } = useMarkdownDocument();
  const fileName = () => persistedName() || fallbackName();

  return createCallback(() => {
    const editor = store.editor;
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
