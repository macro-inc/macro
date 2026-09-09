import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import { createFilesReadyHandler } from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { toast } from '@core/component/Toast/Toast';
import { handleFileFolderDrop } from '@core/util/upload';
import { type FocusableElement, tabbable } from 'tabbable';
import type { ComposeBodyActions } from './context/editor-capabilities';
import { makeAttachmentPublic } from './make-attachment-public';

export function createPanelFocusSibling() {
  const panel = useSplitPanel();
  return (direction: 'next' | 'prev') => {
    const root = panel?.panelRef();
    if (!root) return false;
    const elements = tabbable(root);
    const index = elements.indexOf(document.activeElement as FocusableElement);
    const target =
      index < 0
        ? elements.at(-1)
        : elements[index + (direction === 'next' ? 1 : -1)];
    if (!target) return false;
    target.focus();
    return true;
  };
}

export const readDroppedEmailFiles: ComposeBodyActions['readDroppedFiles'] = (
  files,
  directories,
  onFiles
) =>
  handleFileFolderDrop(files, directories, (uploaded) =>
    onFiles(uploaded.map((item) => item.file))
  );

export function createComposeBodyActions(): ComposeBodyActions {
  return {
    focusSibling: createPanelFocusSibling(),
    recipientAdded: (email) => {
      toast.success(`${email} added to CC`);
    },
    readDroppedFiles: readDroppedEmailFiles,
    pasteFiles(editor, files, directories) {
      handleFileFolderDrop(
        files,
        directories,
        createFilesReadyHandler(
          editor,
          undefined,
          undefined,
          undefined,
          (ids) => ids.forEach(makeAttachmentPublic),
          { width: 542, height: 542 }
        )
      );
    },
  };
}
