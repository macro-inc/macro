import { activeCommentThreadSignal } from '@block-md/comments/commentStore';
import { useBlockId } from '@core/block';
import {
  editorStateAsMarkdown,
  getSaveState,
} from '@core/component/LexicalMarkdown/utils';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { isErr } from '@core/util/maybeResult';
import { utf8Encode } from '@core/util/string';
import { storageServiceClient } from '@service-storage/client';
import { refetchHistory } from '@service-storage/history';
import { refetchResources } from '@service-storage/util/refetchResources';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo } from 'solid-js';
import { mdStore } from './markdownBlockData';

export const useBlockSave = () => {
  const pendingComment = createMemo(() => activeCommentThreadSignal() === -1);

  return pendingComment;
};

export function useSaveMarkdownDocument() {
  const blockSave = useBlockSave();
  const documentId = useBlockId();

  return createCallback(async (text: string) => {
    if (blockSave()) return;

    const buffer = utf8Encode(text);

    const saveRes = await storageServiceClient.simpleSave({
      documentId,
      file: new Blob([buffer], { type: 'text/markdown' }),
    });

    if (isErr(saveRes)) {
      console.error('error on markdown save');
      return;
    }

    await refetchHistory();
  });
}

export function useRenameMarkdownDocument() {
  const documentId = useBlockId();

  return createCallback(async (documentName: string) => {
    const result = await storageServiceClient.editDocument({
      documentId,
      documentName,
    });
    if (isErr(result)) return;

    refetchResources();
  });
}

export function useDownloadDocumentAsMarkdownText() {
  const [store] = mdStore;
  const fileName = useBlockDocumentName();

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
  const [store] = mdStore;
  const fileName = useBlockDocumentName();

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
