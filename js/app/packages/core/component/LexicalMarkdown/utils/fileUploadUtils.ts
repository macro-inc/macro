import type { BlockName } from '@core/block';
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

async function processInlineMediaFiles(
  editor: LexicalEditor,
  files: File[],
  constrainedMediaDimensions?: { width: number; height: number }
) {
  const IMAGE_EXTENSIONS_HEIC = getImageExtensionsHeic();
  const VIDEO_EXTENSIONS = getVideoExtensions();
  for (const file of files) {
    const ext = fileExtension(file.name);
    if (ext != null && IMAGE_EXTENSIONS_HEIC.includes(ext)) {
      const res = await addMediaFromFile(
        editor,
        file,
        'image',
        constrainedMediaDimensions
      );
      if (!res.success) {
        toast.failure('Invalid media attachment file(s)');
      }
    } else if (ext != null && VIDEO_EXTENSIONS.includes(ext)) {
      const res = await addMediaFromFile(
        editor,
        file,
        'video',
        constrainedMediaDimensions
      );
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

async function onFilesReady(
  editor: LexicalEditor,
  uploadEntries: UploadInput[],
  blockId?: string,
  parentBlockName?: BlockName,
  position?: ReturnType<typeof getDragDropPosition>,
  afterFileUpload?: (uploadedItemIds: string[]) => void,
  constrainedMediaDimensions?: { width: number; height: number }
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

  await processInlineMediaFiles(editor, mediaFiles, constrainedMediaDimensions);

  if (filesToUpload.length === 0) return;

  const results = await uploadFiles(filesToUpload, forceDssRuleset);

  let uploadedItemIds: string[] = [];

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
        uploadedItemIds.push(item.id);
        handleBasicMention(item, {
          editor,
          blockName: parentBlockName,
          blockId,
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
      uploadedItemIds.push(item.id);
      handleBasicMention(item, {
        editor,
        blockName: parentBlockName,
        blockId,
        onDocumentMention: () => {},
        disableMentionTracking: false,
      });
    }
  }

  afterFileUpload?.(uploadedItemIds);
}

/**
 * Creates a handler for files ready event.
 * @param editor - The editor instance
 * @param blockId - The block ID.
 * @param getPosition - An optionalfunction to get the position of the files.
 * @returns A function to handle files ready event.
 */
export function createFilesReadyHandler(
  editor: LexicalEditor,
  blockId?: string,
  parentBlockName?: BlockName,
  getPosition?: () => ReturnType<typeof getDragDropPosition>,
  afterFileUpload?: (uploadedItemIds: string[]) => void,
  constrainedMediaDimensions?: { width: number; height: number }
) {
  return async (uploadEntries: UploadInput[]) => {
    if (!editor) return;
    const position = getPosition?.();
    await onFilesReady(
      editor,
      uploadEntries,
      blockId,
      parentBlockName,
      position,
      afterFileUpload,
      constrainedMediaDimensions
    );
  };
}
