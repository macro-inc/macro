import { toast } from '@core/component/Toast/Toast';
import { getImageDimensions, getVideoDimensions } from '@core/util/media';
import {
  createUploadFile,
  createUploadFilePreviewUrl,
  getUploadFilePreviewSource,
  type UploadFile,
} from '@core/util/uploadFile';
import type { InputAttachmentData, InputAttachmentTracker } from './types';
import {
  buildUploadedAttachment,
  getAttachmentKindFromFile,
  iconTypeFromFilename,
  type UploadResult,
} from './utils/file-helpers';

export { getAttachmentKindFromFile } from './utils/file-helpers';

function createAttachmentPreviewSrc(
  file: UploadFile,
  kind: 'image' | 'video' | 'document'
): string | undefined {
  if (kind === 'document') return undefined;

  try {
    return createUploadFilePreviewUrl(file);
  } catch {
    return undefined;
  }
}

function replacePendingAttachment(
  tracker: InputAttachmentTracker,
  pendingId: string,
  uploaded: InputAttachmentData
) {
  const current = tracker.attachments();
  const pendingIndex = current.findIndex(
    (attachment) => attachment.id === pendingId
  );

  if (pendingIndex === -1) {
    tracker.addAttachment(uploaded);
    return;
  }

  const next = [...current];
  next[pendingIndex] = uploaded;
  tracker.setAttachments(next);
}

/**
 * Resolve media dimensions from a File for image/video attachments.
 * Returns undefined for documents or on failure.
 */
async function resolveMediaDimensions(
  file: UploadFile,
  kind: 'image' | 'video' | 'document'
): Promise<{ width: number; height: number } | undefined> {
  if (kind === 'document') return undefined;
  try {
    const source = getUploadFilePreviewSource(file);
    const dims =
      kind === 'image'
        ? await getImageDimensions(source)
        : await getVideoDimensions(source);
    if (dims && dims.width > 0 && dims.height > 0) return dims;
  } catch {
    // Dimension extraction is best-effort
  }
  return undefined;
}

export async function uploadInputAttachments(options: {
  files: File[];
  tracker: InputAttachmentTracker;
  uploadFile: (file: File) => Promise<UploadResult>;
}): Promise<void> {
  for (const file of options.files) {
    const uploadSource = createUploadFile(file);
    const pendingId = crypto.randomUUID();
    const pendingKind = getAttachmentKindFromFile(uploadSource);
    const previewSrc = createAttachmentPreviewSrc(uploadSource, pendingKind);

    options.tracker.addAttachment({
      id: pendingId,
      name: file.name,
      kind: pendingKind,
      iconType:
        pendingKind === 'document'
          ? iconTypeFromFilename(file.name)
          : undefined,
      pending: true,
      previewSrc,
    });

    try {
      const result = await options.uploadFile(file);

      if (result.failed) {
        options.tracker.removeAttachment(pendingId);
        toast.failure(`Failed to upload ${file.name}`);
        continue;
      }

      const uploaded = buildUploadedAttachment(file, pendingKind, result);
      if (!uploaded) {
        options.tracker.removeAttachment(pendingId);
        toast.failure(`Failed to upload ${file.name}`);
        continue;
      }

      if (previewSrc && uploaded.kind !== 'document') {
        uploaded.previewSrc = previewSrc;
      }

      replacePendingAttachment(options.tracker, pendingId, uploaded);

      void resolveMediaDimensions(uploadSource, pendingKind).then((dims) => {
        if (!dims) return;
        options.tracker.setAttachments(
          options.tracker
            .attachments()
            .map((attachment) =>
              attachment.id === uploaded.id
                ? { ...attachment, width: dims.width, height: dims.height }
                : attachment
            )
        );
      });
    } catch (error) {
      console.error('failed to upload attachment', error);
      options.tracker.removeAttachment(pendingId);
      toast.failure(`Failed to upload ${file.name}`);
    }
  }
}
