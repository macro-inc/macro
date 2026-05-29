import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import {
  CHANNEL_IMAGE_FILE_EXTENSIONS,
  CHANNEL_VIDEO_FILE_EXTENSIONS,
} from '../accepted-file-types';
import type { InputAttachmentData, InputAttachmentKind } from '../types';

export type UploadFailedResult = {
  failed: true;
};

export type UploadStaticSuccessResult = {
  failed: false;
  destination: 'static';
  id: string;
};

export type UploadDocumentSuccessResult = {
  failed: false;
  destination: 'dss';
  type: 'document';
  documentId: string;
  fileType?: string;
};

export type UploadResult =
  | UploadFailedResult
  | UploadStaticSuccessResult
  | UploadDocumentSuccessResult
  | {
      failed: false;
      destination: 'dss';
      type: string;
    };

export type UploadSuccess = Exclude<UploadResult, UploadFailedResult>;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(
  CHANNEL_IMAGE_FILE_EXTENSIONS
);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(
  CHANNEL_VIDEO_FILE_EXTENSIONS
);

export function fileExtension(filename: string): string | undefined {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension || extension === filename.toLowerCase()) return;
  return extension;
}

export function iconTypeFromFilename(filename: string) {
  return fileTypeToBlockName(fileExtension(filename), true);
}

export function getAttachmentKindFromFile(file: {
  name: string;
  mimeType?: string;
  type?: string;
}): InputAttachmentKind {
  const mimeType = file.mimeType ?? file.type ?? '';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';

  const extension = fileExtension(file.name);
  if (!extension) return 'document';

  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'document';
}

export function buildUploadedAttachment(
  file: { name: string },
  pendingKind: InputAttachmentKind,
  result: UploadSuccess
): InputAttachmentData | undefined {
  if (result.destination === 'static') {
    return {
      id: result.id,
      name: file.name,
      kind: pendingKind === 'video' ? 'video' : 'image',
    };
  }

  if (
    result.destination === 'dss' &&
    result.type === 'document' &&
    'documentId' in result
  ) {
    return {
      id: result.documentId,
      name: filenameWithoutExtension(file.name) ?? file.name,
      kind: 'document',
      iconType: fileTypeToBlockName(result.fileType, true),
    };
  }

  return undefined;
}
