import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import {
  CHANNEL_IMAGE_FILE_EXTENSIONS,
  CHANNEL_VIDEO_FILE_EXTENSIONS,
} from './accepted-file-types';
import type {
  InputAttachmentData,
  InputAttachmentKind,
  InputAttachmentTracker,
} from './types';

type UploadFailedResult = {
  failed: true;
};

type UploadStaticSuccessResult = {
  failed: false;
  destination: 'static';
  id: string;
};

type UploadDocumentSuccessResult = {
  failed: false;
  destination: 'dss';
  type: 'document';
  documentId: string;
  fileType?: string;
};

type UploadResult =
  | UploadFailedResult
  | UploadStaticSuccessResult
  | UploadDocumentSuccessResult
  | {
      failed: false;
      destination: 'dss';
      type: string;
    };

type UploadSuccess = Exclude<UploadResult, UploadFailedResult>;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(
  CHANNEL_IMAGE_FILE_EXTENSIONS
);
const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(
  CHANNEL_VIDEO_FILE_EXTENSIONS
);

function fileExtension(filename: string): string | undefined {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension || extension === filename.toLowerCase()) return;
  return extension;
}

function iconTypeFromFilename(filename: string) {
  return fileTypeToBlockName(fileExtension(filename), true);
}

export function getAttachmentKindFromFile(
  file: Pick<File, 'name' | 'type'>
): InputAttachmentKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';

  const extension = fileExtension(file.name);
  if (!extension) return 'document';

  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'document';
}

function buildUploadedAttachment(
  file: File,
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

export async function uploadInputAttachments(options: {
  files: File[];
  tracker: InputAttachmentTracker;
  uploadFile: (file: File) => Promise<UploadResult>;
  onUpdated?: () => void;
}): Promise<void> {
  for (const file of options.files) {
    const pendingId = crypto.randomUUID();
    const pendingKind = getAttachmentKindFromFile(file);

    options.tracker.addAttachment({
      id: pendingId,
      name: file.name,
      kind: pendingKind,
      iconType:
        pendingKind === 'document'
          ? iconTypeFromFilename(file.name)
          : undefined,
      pending: true,
    });
    options.onUpdated?.();

    try {
      const result = await options.uploadFile(file);

      if (result.failed) {
        options.tracker.removeAttachment(pendingId);
        options.onUpdated?.();
        toast.failure(`Failed to upload ${file.name}`);
        continue;
      }

      const uploaded = buildUploadedAttachment(file, pendingKind, result);
      if (!uploaded) {
        options.tracker.removeAttachment(pendingId);
        options.onUpdated?.();
        toast.failure(`Failed to upload ${file.name}`);
        continue;
      }

      options.tracker.removeAttachment(pendingId);
      options.tracker.addAttachment(uploaded);
      options.onUpdated?.();
    } catch (error) {
      console.error('failed to upload attachment', error);
      options.tracker.removeAttachment(pendingId);
      options.onUpdated?.();
      toast.failure(`Failed to upload ${file.name}`);
    }
  }
}
