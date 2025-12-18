import { toast } from '@core/component/Toast/Toast';
import {
  blockNameToFileExtensions,
  fileTypeToBlockName,
} from '@core/constant/allBlocks';
import { HEIC_EXTENSIONS } from '@core/heic';
import {
  forceDssRuleset,
  isFileUploadEntry,
  type UploadInput,
  uploadFiles,
} from '@core/util/upload';
import { logger } from '@observability';
import { fileExtension } from '@service-storage/util/filename';
import type { LexicalEditor } from 'lexical';
import {
  calculateInsertPoint,
  SET_SELECTION_AT_INSERTION,
} from '../plugins/drag-insert/dragInsertPlugin';
import { addMediaFromFile } from '../plugins/media';
import { documentUploadToItem, handleBasicMention } from './mentionsUtils';

const getImageExtensionsHeic = () => [
  ...blockNameToFileExtensions.image,
  ...HEIC_EXTENSIONS,
];
const getVideoExtensions = () => blockNameToFileExtensions.video;

async function processInlineMediaFiles(editor: LexicalEditor, files: File[]) {
  const IMAGE_EXTENSIONS_HEIC = getImageExtensionsHeic();
  const VIDEO_EXTENSIONS = getVideoExtensions();
  for (const file of files) {
    const ext = fileExtension(file.name);
    if (ext != null && IMAGE_EXTENSIONS_HEIC.includes(ext)) {
      const res = await addMediaFromFile(editor, file, 'image');
      if (!res.success) {
        toast.failure('Invalid media attachment file(s)');
      }
    } else if (ext != null && VIDEO_EXTENSIONS.includes(ext)) {
      const res = await addMediaFromFile(editor, file, 'video');
      if (!res.success) {
        toast.failure('Invalid media attachment file(s)');
      }
    }
  }
}

const DRAG_EVENT_PADDING = 8;

export const getDragDropPosition = (
  editor: LexicalEditor,
  e: DragEvent | { clientX: number; clientY: number },
  setSelection = false
) => {
  const { key, position } = calculateInsertPoint(editor, e, DRAG_EVENT_PADDING);
  if (setSelection && key !== null && position !== null) {
    editor.dispatchCommand(SET_SELECTION_AT_INSERTION, [key, position]);
  }
  return { key, position };
};

export async function onFilesReady(
  editor: LexicalEditor,
  uploadEntries: UploadInput[],
  blockId: string,
  position?: ReturnType<typeof getDragDropPosition>
): Promise<void> {
  const IMAGE_EXTENSIONS_HEIC = getImageExtensionsHeic();
  const VIDEO_EXTENSIONS = getVideoExtensions();
  const mediaFiles: File[] = [];
  const filesToUpload: UploadInput[] = [];

  for (const entry of uploadEntries) {
    if (isFileUploadEntry(entry) && entry.isFolder) {
      filesToUpload.push(entry);
    } else {
      const file = isFileUploadEntry(entry) ? entry.file : entry;
      const ext = fileExtension(file.name);
      if (
        ext != null &&
        (IMAGE_EXTENSIONS_HEIC.includes(ext) || VIDEO_EXTENSIONS.includes(ext))
      ) {
        mediaFiles.push(file);
      } else {
        filesToUpload.push(entry);
      }
    }
  }

  if (position) {
    const { key, position: position_ } = position;
    if (key !== null && position_ !== null) {
      editor.dispatchCommand(SET_SELECTION_AT_INSERTION, [key, position_]);
    }
  }

  await processInlineMediaFiles(editor, mediaFiles);

  if (filesToUpload.length === 0) return;

  const results = await uploadFiles(filesToUpload, forceDssRuleset);

  for (const result of results) {
    if (result.failed) continue;

    if (result.destination !== 'dss') continue;

    if (result.type === 'document') {
      const blockName = fileTypeToBlockName(result.fileType, true);
      if (blockName) {
        const item = await documentUploadToItem(result);
        if (!item) {
          toast.failure('Document upload failed or timed out');
          logger.error('Document upload failed or timed out', {
            cause: new Error(),
          });
          continue;
        }
        handleBasicMention(item, {
          editor,
          blockName: 'md',
          blockId: blockId,
          onDocumentMention: () => {},
          disableMentionTracking: false,
        });
      }
    } else if (result.type === 'folder') {
      const item = await documentUploadToItem(result);
      if (!item) {
        toast.failure('Folder upload failed or timed out');
        logger.error('Folder upload failed or timed out', {
          cause: new Error(),
        });
        continue;
      }
      handleBasicMention(item, {
        editor,
        blockName: 'md',
        blockId: blockId,
        onDocumentMention: () => {},
        disableMentionTracking: false,
      });
    }
  }
}

export function createFilesReadyHandler(
  editor: LexicalEditor,
  blockId: string,
  getPosition?: () => ReturnType<typeof getDragDropPosition>
) {
  return async (uploadEntries: UploadInput[]) => {
    const position = getPosition?.();
    await onFilesReady(editor, uploadEntries, blockId, position);
  };
}
