import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { forceDssRuleset, uploadFiles } from '@core/util/upload';
import type { UploadedDocument } from './context/compose-capabilities';

/** Uploads files as Macro documents; the upload toasts report each outcome. */
export async function uploadAttachmentDocuments(
  files: File[]
): Promise<UploadedDocument[]> {
  let results: Awaited<ReturnType<typeof uploadFiles>>;
  try {
    results = await uploadFiles(files, forceDssRuleset);
  } catch {
    // A file over the upload size limit has already been reported by its toast.
    return [];
  }
  return results.flatMap((result) =>
    result.failed || result.destination !== 'dss' || result.type !== 'document'
      ? []
      : [
          {
            documentId: result.documentId,
            name: result.name,
            blockName: fileTypeToBlockName(result.fileType),
          },
        ]
  );
}
