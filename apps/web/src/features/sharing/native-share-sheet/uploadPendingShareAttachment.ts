import type {
  InputAttachmentData,
  InputAttachmentKind,
  InputAttachmentTracker,
} from '@channel/Input';
import {
  buildUploadedAttachment as buildInputUploadedAttachment,
  getAttachmentKindFromFile,
} from '@channel/Input/utils/file-helpers';
import { createNativeStagedUploadFile } from '@core/mobile/nativeStagedUpload';
import { chatRuleset, uploadFile } from '@core/util/upload';
import type {
  PendingShareFile,
  UploadPendingShareFileArgs,
} from '@macro/tauri';

function getPendingShareAttachmentKind(
  file: Pick<PendingShareFile, 'name' | 'mimeType'>
): InputAttachmentKind {
  return getAttachmentKindFromFile({
    name: file.name,
    type: file.mimeType,
  });
}

type ShareSheetAttachmentKind = Extract<InputAttachmentKind, 'image' | 'video'>;

function buildMediaAttachment(
  file: PendingShareFile,
  staticFileId: string,
  kind: ShareSheetAttachmentKind
): InputAttachmentData {
  return {
    id: staticFileId,
    name: file.name,
    kind,
    previewSrc: file.previewSrc,
  };
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
}): Promise<boolean> {
  const kind = getPendingShareAttachmentKind(options.file);
  const pendingId = `pending-share:${options.file.token}`;
  options.tracker.addAttachment({
    id: pendingId,
    name: options.file.name,
    kind,
    pending: true,
    previewSrc: kind === 'image' ? options.file.previewSrc : undefined,
  });
  try {
    let attachment: InputAttachmentData | undefined;
    if (kind === 'document') {
      const file = options.file.sha256
        ? createNativeStagedUploadFile('share', {
            ...options.file,
            previewPath: null,
          })
        : null;
      if (!file) throw new Error('This shared document is unavailable');
      const result = await uploadFile(file, chatRuleset, {
        hideProgressIndicator: true,
      });
      if (result.failed) throw result.error;
      attachment = buildInputUploadedAttachment(file, kind, result);
    } else {
      const result = await options.prepareMedia(options.file);
      if (!options.uploadPendingShareFile)
        throw new Error('Missing native shared file uploader');
      await options.uploadPendingShareFile({
        token: options.file.token,
        uploadUrl: result.upload_url,
        mimeType: options.file.mimeType,
      });
      attachment = buildMediaAttachment(options.file, result.id, kind);
    }
    if (!attachment) throw new Error('Unable to prepare shared attachment');
    if (!options.isActive()) return false;
    options.tracker.removeAttachment(pendingId);
    options.tracker.addAttachment({
      ...attachment,
      mimeType: options.file.mimeType,
      size: options.file.size,
    });
    return true;
  } catch (error) {
    if (!options.isActive()) return false;
    options.tracker.removeAttachment(pendingId);
    console.error('Failed to upload shared attachment', error);
    return false;
  }
}
