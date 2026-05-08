import { toast } from '@core/component/Toast/Toast';
import { getImageDimensions, getVideoDimensions } from '@core/util/media';
import type { InputAttachmentTracker } from './types';
import {
  buildUploadedAttachment,
  getAttachmentKindFromFile,
  iconTypeFromFilename,
  type UploadResult,
} from './utils/file-helpers';

export { getAttachmentKindFromFile } from './utils/file-helpers';

/**
 * Resolve media dimensions from a File for image/video attachments.
 * Returns undefined for documents or on failure.
 */
async function resolveMediaDimensions(
  file: File,
  kind: 'image' | 'video' | 'document'
): Promise<{ width: number; height: number } | undefined> {
  if (kind === 'document') return undefined;
  try {
    const dims =
      kind === 'image'
        ? await getImageDimensions(file)
        : await getVideoDimensions(file);
    if (dims.width > 0 && dims.height > 0) return dims;
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

    try {
      const [result, dims] = await Promise.all([
        options.uploadFile(file),
        resolveMediaDimensions(file, pendingKind),
      ]);

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

      if (dims) {
        uploaded.width = dims.width;
        uploaded.height = dims.height;
      }

      options.tracker.removeAttachment(pendingId);
      options.tracker.addAttachment(uploaded);
    } catch (error) {
      console.error('failed to upload attachment', error);
      options.tracker.removeAttachment(pendingId);
      toast.failure(`Failed to upload ${file.name}`);
    }
  }
}
