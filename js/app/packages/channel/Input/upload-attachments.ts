import { toast } from '@core/component/Toast/Toast';
import {
  getAttachmentKindFromFile,
  iconTypeFromFilename,
  buildUploadedAttachment,
  type UploadResult,
} from './utils/file-helpers';
import type { InputAttachmentTracker } from './types';

export { getAttachmentKindFromFile } from './utils/file-helpers';

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

      options.tracker.removeAttachment(pendingId);
      options.tracker.addAttachment(uploaded);
    } catch (error) {
      console.error('failed to upload attachment', error);
      options.tracker.removeAttachment(pendingId);
      toast.failure(`Failed to upload ${file.name}`);
    }
  }
}
