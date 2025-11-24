import type { BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type {
  AttachmentType,
  InputAttachment,
} from '@core/store/cacheChannelInput';
import {
  isStaticAttachmentType,
  STATIC_IMAGE,
  STATIC_VIDEO,
} from '@core/store/cacheChannelInput';
import type { UploadInput } from '@core/util/upload';
import { chatRuleset, isFileUploadEntry, uploadFile } from '@core/util/upload';
import type { NewAttachment } from '@service-comms/generated/models';
import { waitBulkUploadStatus } from '@service-connection/bulkUpload';
import { blockNameToItemType } from '@service-storage/client';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import { toast } from 'core/component/Toast/Toast';
import type { SetStoreFunction } from 'solid-js/store';

type InputAttachmentsStore = {
  store: Record<string, InputAttachment[]>;
  setStore: SetStoreFunction<Record<string, InputAttachment[]>>;
  key: string;
};

// Simplified attachment type matching for indicating pending attachment state before upload
// For example, heic image conversion can be slow so this will show a correct pending state
function getAttachmentType(fileType?: string): AttachmentType | undefined {
  if (!fileType) return;

  if (fileType.startsWith('image/')) {
    return STATIC_IMAGE;
  }
  if (fileType.startsWith('video/')) {
    return STATIC_VIDEO;
  }

  // For other files, we'll determine the type after upload
  return undefined;
}

export function mapAttachmentsForSend(
  attachments: InputAttachment[]
): NewAttachment[] {
  return attachments
    .map((a) => ({
      entity_id: a.id,
      entity_type: isStaticAttachmentType(a.blockName)
        ? a.blockName
        : blockNameToItemType(a.blockName as BlockName),
    }))
    .filter((a) => a.entity_type !== undefined) as NewAttachment[];
}

export async function handleFileUpload(
  files: UploadInput[],
  inputAttachmentsStore: InputAttachmentsStore,
  onUploaded?: (attachment: InputAttachment) => void
) {
  const key = inputAttachmentsStore.key;
  let newAttachments: InputAttachment[] =
    inputAttachmentsStore.store[key] ?? [];

  for (const entry of files) {
    const file = isFileUploadEntry(entry) ? entry.file : entry;
    const pendingId = crypto.randomUUID();
    const initialAttachmentType = getAttachmentType(file.type);

    // Add pending attachment to UI immediately
    const pendingAttachment: InputAttachment = {
      id: pendingId,
      name: file.name,
      blockName: initialAttachmentType || 'unknown',
      pending: true,
    };

    newAttachments = [...newAttachments, pendingAttachment];
    inputAttachmentsStore.setStore(key, newAttachments);

    try {
      const result = await uploadFile(file, chatRuleset, {
        hideProgressIndicator: true,
        unzipFolder: isFileUploadEntry(entry) && entry.isFolder,
      });

      if (!result.failed) {
        // Determine final attachment based on upload destination
        let finalAttachment: InputAttachment;

        if (result.destination === 'static') {
          finalAttachment = {
            id: result.id,
            name: file.name,
            blockName: initialAttachmentType || 'unknown',
            pending: false,
          };
        } else if (result.destination === 'dss' && result.type === 'document') {
          finalAttachment = {
            id: result.documentId,
            name: filenameWithoutExtension(file.name) || file.name,
            blockName: fileTypeToBlockName(result.fileType, true) ?? 'unknown',
            pending: false,
          };
        } else if (result.destination === 'dss' && result.type === 'folder') {
          // Wait for the websocket event to get the projectId
          const projectId = await waitBulkUploadStatus(result.requestId);
          if (!projectId) {
            throw new Error('Folder upload failed or timed out');
          }

          finalAttachment = {
            id: projectId,
            name: result.name,
            blockName: 'project',
            pending: false,
          };
        } else {
          throw new Error('Unexpected upload result');
        }

        // Update the attachment in place
        inputAttachmentsStore.setStore(key, (prev = []) => {
          const index = prev.findIndex((a) => a.id === pendingId);
          if (index < 0) return prev;
          return [
            ...prev.slice(0, index),
            finalAttachment,
            ...prev.slice(index + 1),
          ];
        });

        onUploaded?.(finalAttachment);
      } else {
        // Remove failed attachment
        inputAttachmentsStore.setStore(key, (prev = []) =>
          prev.filter((a) => a.id !== pendingId)
        );
        if (result.error) {
          toast.failure(`Failed to upload ${file.name}: ${result.error}`);
        }
      }
    } catch (error) {
      console.error('File upload error:', error);
      toast.failure(`Failed to upload file: ${file.name}`);
      // Remove failed attachment
      inputAttachmentsStore.setStore(key, (prev = []) =>
        prev.filter((a) => a.id !== pendingId)
      );
    }
  }
}
