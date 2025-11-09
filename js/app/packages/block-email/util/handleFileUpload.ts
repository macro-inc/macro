import { toast } from '@core/component/Toast/Toast';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { forceDssRuleset, uploadFile } from '@core/util/upload';
import type { DocumentMentionInfo } from '@lexical-core';
import { waitBulkUploadStatus } from '@service-connection/bulkUpload';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import type { Setter } from 'solid-js';

export async function handleFileUpload(
  files: File[],
  setIsPending: Setter<boolean>,
  onUploaded: (items: DocumentMentionInfo[]) => void
) {
  setIsPending(true);
  let mentionItems: DocumentMentionInfo[] = [];
  for (const file of files) {
    try {
      // TODO (seamus): For now, we force all uploads to DSS so that macro links work correctly as attachments.
      const result = await uploadFile(file, forceDssRuleset, {
        hideProgressIndicator: true,
      });

      if (!result.failed) {
        let mentionItem: DocumentMentionInfo | undefined;

        if (result.destination === 'static') {
          // TODO if user uploads static file... we shouldn't mention it, but instead should be inlining it into the body
        } else if (result.destination === 'dss' && result.type === 'document') {
          mentionItem = {
            documentId: result.documentId,
            documentName: filenameWithoutExtension(file.name) || file.name,
            blockName: fileTypeToBlockName(result.fileType, true) ?? 'unknown',
          };
        } else if (result.destination === 'dss' && result.type === 'folder') {
          // Wait for the websocket event to get the projectId
          const projectId = await waitBulkUploadStatus(result.requestId);
          if (!projectId) {
            throw new Error('Folder upload failed or timed out');
          }

          mentionItem = {
            documentId: projectId,
            documentName: result.name,
            blockName: 'project',
          };
        } else {
          throw new Error('Unexpected upload result');
        }

        setIsPending(false);

        if (mentionItem) {
          mentionItems.push(mentionItem);
        }
      } else {
        setIsPending(false);
        toast.failure(`Failed to upload ${file.name}: ${result.error}`);
      }
    } catch (error) {
      setIsPending(false);
      toast.failure(`Failed to upload ${file.name}: ${error}`);
    }
  }

  onUploaded(mentionItems);
}
