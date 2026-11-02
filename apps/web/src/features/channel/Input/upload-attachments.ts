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
    return false;
  }

  const next = [...current];
  next[pendingIndex] = uploaded;
  tracker.setAttachments(next);
  return true;
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
  /** Stop publishing uploads after the owning draft is disposed. */
  isActive?: () => boolean;
}): Promise<void> {
  const isActive = options.isActive ?? (() => true);
  for (const file of options.files) {
    if (!isActive()) break;
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

    // A full tracker rejected this file; do not upload an invisible attachment.
    if (!options.tracker.attachments().some((item) => item.id === pendingId)) {
      if (previewSrc) URL.revokeObjectURL(previewSrc);
      toast.failure(`Could not attach ${file.name}: attachment limit reached`);
      continue;
    }

    let retainedPreview = false;
    try {
      const dimensionsPromise = resolveMediaDimensions(
        uploadSource,
        pendingKind
      );
      const result = await options.uploadFile(file);

      if (!isActive()) continue;

      if (result.failed) {
        toast.failure(result.reason ?? `Failed to upload ${file.name}`);
        continue;
      }

      const dimensions = await dimensionsPromise;
      if (!isActive()) continue;
      const uploaded = buildUploadedAttachment(file, pendingKind, result);
      if (!uploaded) {
        toast.failure(`Failed to upload ${file.name}`);
        continue;
      }

      if (previewSrc && uploaded.kind !== 'document') {
        uploaded.previewSrc = previewSrc;
      }
      if (file.type) uploaded.mimeType = file.type;
      uploaded.size = uploadSource.size;
      if (dimensions) {
        uploaded.width = dimensions.width;
        uploaded.height = dimensions.height;
      }

      retainedPreview = replacePendingAttachment(
        options.tracker,
        pendingId,
        uploaded
      );
    } catch (error) {
      console.error('failed to upload attachment', error);
      if (isActive()) toast.failure(`Failed to upload ${file.name}`);
    } finally {
      if (!retainedPreview) {
        options.tracker.removeAttachment(pendingId);
        if (previewSrc) URL.revokeObjectURL(previewSrc);
      }
    }
  }
}
