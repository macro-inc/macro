import type {
  InputAttachmentData,
  InputAttachmentTracker,
} from '@channel/Input';
import {
  buildUploadedAttachment as buildInputUploadedAttachment,
  getAttachmentKindFromFile,
} from '@channel/Input/utils/file-helpers';
import { toast } from '@core/component/Toast/Toast';
import { createNativeStagedUploadFile } from '@core/mobile/nativeStagedUpload';
import { chatRuleset, uploadFile } from '@core/util/upload';
import type {
  PendingShareFile,
  UploadPendingShareFileArgs,
} from '@macro/tauri';

export type PendingShareUploadResult = 'uploaded' | 'skipped' | 'failed';

async function uploadDocument(file: PendingShareFile) {
  const staged = createNativeStagedUploadFile('share', {
    ...file,
    previewPath: null,
  });
  if (!staged) throw new Error('This shared document is unavailable');
  const result = await uploadFile(staged, chatRuleset, {
    hideProgressIndicator: true,
  });
  if (result.failed) throw result.error;
  const attachment = buildInputUploadedAttachment(staged, 'document', result);
  if (!attachment) throw new Error('Unable to prepare shared attachment');
  return attachment;
}

export async function uploadPendingShareAttachment(options: {
  file: PendingShareFile;
  tracker: InputAttachmentTracker;
  prepareMedia: (file: {
    name: string;
    mimeType: string;
  }) => Promise<{ id: string; upload_url: string }>;
  uploadPendingShareFile:
    | ((args: UploadPendingShareFileArgs) => Promise<void>)
    | undefined;
  isActive: () => boolean;
}): Promise<PendingShareUploadResult> {
  const { file, tracker } = options;
  const kind = getAttachmentKindFromFile({
    name: file.name,
    type: file.mimeType,
  });
  // Documents stream from native staging, which needs the staged digest. The
  // iOS share extension does not supply one, so skip the file and keep the
  // rest of the share sendable.
  if (kind === 'document' && !file.sha256) {
    toast.failure(`Can't share ${file.name} from iOS yet`);
    return 'skipped';
  }
  const pendingId = `pending-share:${file.token}`;
  tracker.addAttachment({
    id: pendingId,
    name: file.name,
    kind,
    pending: true,
    previewSrc: kind === 'image' ? file.previewSrc : undefined,
  });
  try {
    let attachment: InputAttachmentData;
    if (kind === 'document') {
      attachment = await uploadDocument(file);
    } else {
      const result = await options.prepareMedia(file);
      if (!options.uploadPendingShareFile)
        throw new Error('Missing native shared file uploader');
      await options.uploadPendingShareFile({
        token: file.token,
        uploadUrl: result.upload_url,
        mimeType: file.mimeType,
      });
      attachment = {
        id: result.id,
        name: file.name,
        kind,
        previewSrc: file.previewSrc,
      };
    }
    if (!options.isActive()) return 'failed';
    tracker.removeAttachment(pendingId);
    tracker.addAttachment({
      ...attachment,
      mimeType: file.mimeType,
      size: file.size,
    });
    return 'uploaded';
  } catch (error) {
    if (!options.isActive()) return 'failed';
    tracker.removeAttachment(pendingId);
    console.error('Failed to upload shared attachment', error);
    return 'failed';
  }
}
