import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import {
  createFilesReadyHandler,
  getDragDropPosition,
  isInlineVideoFileName,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  handleFileFolderDrop,
  isFileUploadEntry,
  type UploadInput,
} from '@core/util/upload';
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

export function withVideoAttachments(
  onFilesReady: (entries: UploadInput[]) => Promise<void>,
  onVideos: ((files: File[]) => void) | undefined
) {
  if (!onVideos) return onFilesReady;
  return (entries: UploadInput[]) => {
    const videos: File[] = [];
    const rest = entries.filter((entry) => {
      if (isFileUploadEntry(entry) && entry.isFolder) return true;
      const file = isFileUploadEntry(entry) ? entry.file : entry;
      if (!isInlineVideoFileName(file.name)) return true;
      videos.push(file);
      return false;
    });
    if (videos.length > 0) onVideos(videos);
    return onFilesReady(rest);
  };
}

export function createComposeBodyActions(): ComposeBodyActions {
  return {
    focusSibling: createPanelFocusSibling(),
    recipientAdded: (email) => {
      toast.success(`${email} added to CC`);
    },
    readDroppedFiles: readDroppedEmailFiles,
    insertFiles(editor, { files, directories, dropEvent, onVideos }) {
      handleFileFolderDrop(
        files,
        directories,
        withVideoAttachments(
          createFilesReadyHandler(
            editor,
            undefined,
            undefined,
            dropEvent
              ? () => getDragDropPosition(editor, dropEvent, true)
              : undefined,
            (ids) => ids.forEach(makeAttachmentPublic),
            { width: 542, height: 542 }
          ),
          onVideos
        )
      );
    },
  };
}
