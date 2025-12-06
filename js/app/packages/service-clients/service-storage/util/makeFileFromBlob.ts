import {
  createDocumentStorageServiceHandle,
  makeFile,
} from '@coparse/filesystem';
import type {
  DocumentKeyParts,
  FileSystemFile,
} from '@coparse/filesystem/src/file';
import type { DocumentMetadata } from '@macro-inc/document-processing-job-types';

export async function makeFileFromBlob({
  blob,
  documentKeyParts,
  fileName,
  mimeType,
  metadata,
}: {
  blob: BlobPart;
  documentKeyParts: DocumentKeyParts;
  fileName: string;
  // TODO- @sam Generic types
  mimeType: string;
  metadata: DocumentMetadata;
}): Promise<FileSystemFile> {
  const handle = createDocumentStorageServiceHandle(documentKeyParts);
  const file = await makeFile({
    fileBits: [blob],
    fileName,
    handle,
    options: {
      type: mimeType,
      lastModified: Date.now(),
    },
    metadata,
  });

  return file;
}
