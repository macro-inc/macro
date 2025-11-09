import {
  SUPPORTED_ATTACHMENT_EXTENSIONS,
  SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS,
} from '@core/component/AI/constant';
import type {
  AttachmentPreview,
  SupportedResult,
  UploadingAttachment,
  UploadQueue,
  UploadResult,
} from '@core/component/AI/types';
import { toast } from '@core/component/Toast/Toast';
import { chatRuleset, uploadFile } from '@core/util/upload';
import {
  fileExtension,
  filenameWithoutExtension,
} from '@service-storage/util/filename';
import { waitExtractionStatus } from 'service-cognition/extraction';
import { createSignal, untrack } from 'solid-js';
import { asFileType } from './attachment';

async function uploadFileForChat(
  file: File,
  preview: AttachmentPreview
): Promise<UploadResult> {
  try {
    const result = await uploadFile(file, chatRuleset, {
      hideProgressIndicator: true,
      skipWaitForDocxProcessing: true,
    });

    if (result.failed) {
      return {
        type: 'error',
        error: 'upload',
        preview,
      };
    }

    // For documents uploaded to DSS, check extraction status
    // TODO: do we need this for pdf/docx only or can this be removed?
    if (
      result.destination === 'dss' &&
      result.type === 'document' &&
      ['pdf', 'docx'].includes(result.fileType as any)
    ) {
      const status = await waitExtractionStatus(result.documentId);
      if (status === 'error') {
        return {
          type: 'error',
          error: 'extract',
          preview,
        };
      }
    }

    let attachmentId: string;
    switch (result.destination) {
      case 'static':
        attachmentId = result.id;
        break;
      case 'dss':
        if (result.type !== 'document') {
          throw new Error('Unexpected upload result');
        }
        attachmentId = result.documentId;
        break;
      default:
        throw new Error('Unexpected upload result');
    }

    return {
      type: 'ok',
      attachment: {
        attachmentId,
        attachmentType: preview.attachmentType,
        id: attachmentId,
        metadata: preview.metadata,
      },
    };
  } catch (error) {
    console.error('Upload error:', error);
    return {
      type: 'error',
      error: 'upload',
      preview,
    };
  }
}

function previewFile(file: File): AttachmentPreview | undefined {
  const ext = fileExtension(file.name);
  const name = filenameWithoutExtension(file.name);
  if (!ext || !name) return;
  if (!SUPPORTED_ATTACHMENT_EXTENSIONS.includes(ext)) return;

  const fileType = asFileType(ext);
  if (!fileType) return;

  if (SUPPORTED_IMAGE_ATTACHMENT_EXTENSIONS.includes(fileType)) {
    return {
      attachmentType: 'image',
      metadata: {
        type: 'image',
        image_extension: fileType,
        image_name: name,
      },
    };
  }

  return {
    attachmentType: 'document',
    metadata: {
      type: 'document',
      document_name: name,
      document_type: fileType,
    },
  };
}

function isFileSupported(file: File): boolean {
  return !!previewFile(file);
}

function uploadFileForChatQueue(
  file: File
): [SupportedResult, Promise<UploadResult> | null] {
  const preview = previewFile(file);
  if (!preview) return [{ file: file, type: 'unsupported' }, null];

  const uploadPromise = uploadFileForChat(file, preview);

  return [{ type: 'ok', file }, uploadPromise];
}

const getUploadFilename = (
  result: Extract<UploadResult, { type: 'error' }> | UploadingAttachment
) => {
  let filename = 'file';

  if (result.preview.metadata) {
    if (
      result.preview.metadata.type === 'document' &&
      'document_name' in result.preview.metadata
    ) {
      filename = result.preview.metadata.document_name;
    } else if (
      result.preview.metadata.type === 'image' &&
      'image_name' in result.preview.metadata
    ) {
      filename = result.preview.metadata.image_name;
    }
  }

  return filename;
};

export function useUploadAttachment(): UploadQueue {
  const [uploading, setUploading] = createSignal<UploadingAttachment[]>([]);
  const [complete, setComplete] = createSignal<UploadResult[]>([]);
  const [update, setUpdate] = createSignal(0);

  const popComplete = () => {
    update();
    const d = untrack(complete);
    untrack(() => setComplete([]));
    return d;
  };

  const waitForUploads = (items: UploadingAttachment[]) => {
    // Add to uploading immediately for UI reactivity
    setUploading((prev) => [...prev, ...items]);

    // Wire up completions
    for (const item of items) {
      item.upload
        .then((result) => {
          // Remove from uploading
          setUploading((prev) => prev.filter((u) => u !== item));

          // Show error toast if the result indicates an error
          if (result.type === 'error') {
            let filename = getUploadFilename(result);

            const errorMessage =
              result.error === 'upload'
                ? `Failed to upload ${filename}`
                : `Failed to process ${filename} (extraction error)`;
            toast.failure(errorMessage);
            console.error('Upload result error:', result);
          }

          // Append to complete
          setComplete((prev) => [...prev, result]);
          setUpdate((p) => p + 1);
        })
        .catch((error) => {
          // Remove from uploading on error
          setUploading((prev) => prev.filter((u) => u !== item));

          let filename = getUploadFilename(item);

          // Show error toast
          toast.failure(
            `Failed to upload ${filename}: ${error.message || 'Unknown error'}`
          );
          console.error('Upload error:', error);
        });
    }
  };

  const upload = (files: File[]) => {
    const allValid = files.every(isFileSupported);
    if (files.length === 0 || !allValid) {
      toast.failure('Invalid attachment file(s)');
      return [];
    }

    const results = files.map(uploadFileForChatQueue);

    const supported: SupportedResult[] = results.map((r) => r[0]);

    // Build UploadingAttachment[] with previews for supported files
    const items: UploadingAttachment[] = [];
    for (const [supportedResult, promise] of results) {
      if (supportedResult.type === 'ok' && promise) {
        const preview = previewFile(supportedResult.file);
        if (preview) {
          items.push({ preview, upload: promise });
        }
      }
    }

    if (items.length) {
      waitForUploads(items);
    }

    return supported;
  };

  return {
    upload,
    uploading,
    popComplete,
  };
}
