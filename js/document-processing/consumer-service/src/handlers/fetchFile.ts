import type { JobTypes } from '@macro-inc/document-processing-job-types';
import JSZip from 'jszip';
import { config } from '../config';
import { documentStorageService } from '../service/documentStorageService';
import { pdfService } from '../service/pdfService';
import { s3Client } from '../service/s3Service';
import type { GetDocumentResponse } from '../types/documentStorageService';
import type { File } from '../types/file';
import { PdfServiceError } from '../utils/error';
import { getLogger } from '../utils/logger';

/**
 * @description Given a document in DSS, this will get that document and return
 * it as a "File" to be used in jobs
 * @throws Error in the event something unexpected occurs
 */
export async function fetchFile(
  documentId: string,
  documentVersionId: number
): Promise<File> {
  const logger = getLogger();
  const metadata: { [name: string]: any } = {
    document_id: documentId,
    document_version_id: documentVersionId,
  };
  const document = await documentStorageService().get_document_version(
    documentId,
    documentVersionId
  );

  if (document.error) {
    logger.error('unable to get document version', { ...metadata, document });
    throw new Error('unable to get document version');
  }

  if (!document.data) {
    logger.error('document data is empty', { ...metadata, document });
    throw new Error('document data is empty');
  }
  const documentMetadata = document.data.documentMetadata;

  // shas to download
  const toDownload = new Set<string>();
  // collection of path: sha pairs
  const docxFileBoms: { [path: string]: string }[] = [];

  if (documentMetadata.fileType === 'docx') {
    const docxFileBom: { [path: string]: string } = {};
    for (const bomPart of documentMetadata.documentBom) {
      docxFileBom[bomPart.path] = bomPart.sha;
      toDownload.add(bomPart.sha);
    }
    docxFileBoms.push(docxFileBom);
  } else {
    toDownload.add(
      formatPdfKey({
        owner: documentMetadata.owner,
        documentId: documentId,
        documentVersionId: documentVersionId,
      })
    );
  }

  const docStorageBucket = config().docStorageBucket;
  const downloadPromises: Promise<{
    key: string;
    data: Uint8Array | undefined;
  }>[] = Array.from(toDownload).map(async (key) => ({
    key,
    data: await s3Client().getObject(docStorageBucket, key),
  }));
  const downloads: { key: string; data: Uint8Array | undefined }[] =
    await Promise.all(downloadPromises);

  // If we were unable to download any parts we need to throw
  if (downloads.find((d) => d.data === undefined)) {
    logger.error('failed to download all document parts', {
      ...metadata,
      document,
      failed: downloads.filter((d) => d.data === undefined).map((d) => d.key),
    });
    throw new Error('Failed to download all documents');
  }

  if (documentMetadata.fileType === 'pdf') {
    const pdfDownload = downloads.find(
      (d) =>
        d.key ===
        formatPdfKey({
          owner: documentMetadata.owner,
          documentId: documentId,
          documentVersionId: documentVersionId,
        })
    );
    if (!pdfDownload) {
      logger.error('pdf download not found', {
        ...metadata,
        document,
        key: formatPdfKey({
          owner: documentMetadata.owner,
          documentId: documentId,
          documentVersionId: documentVersionId,
        }),
      });
      throw new Error('pdf download not found');
    }

    return {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      blob: new Blob([pdfDownload.data!]),
      name: `${documentMetadata.documentName}`,
      type: 'pdf',
    };
  } else {
    // Docx file
    const zip = new JSZip();
    for (const bomPart of documentMetadata.documentBom) {
      const content: Uint8Array | undefined = downloads.find(
        (d) => d.key === bomPart.sha
      )?.data;
      if (!content) {
        logger.error('failed to find content for bom part', {
          ...metadata,
          document,
          bomPart,
        });
        throw new Error(`Failed to find content for ${bomPart.sha}`);
      }
      zip.file(bomPart.path, content);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    return {
      blob,
      name: documentMetadata.documentName,
      type: 'docx',
    };
  }
}

/**
 * @description Fetches all necessary files for the compare service, converting
 * any to docx if necessary
 * @throws Error in the event something unexpected occurs
 */
export async function fetchCompareFiles(
  jobId: string,
  userId: string,
  jobType: JobTypes,
  compareFilesInfo: (
    | { documentId: string; documentVersionId: number }
    | { documentKey: string; fileName: string }
  )[]
): Promise<File[]> {
  const logger = getLogger();
  const metadata: { [name: string]: any } = {
    job_id: jobId,
    user_id: userId,
    job_type: jobType,
    files: compareFilesInfo,
  };
  const documents: (GetDocumentResponse | { key: string; fileName: string })[] =
    await Promise.all(
      compareFilesInfo.map((cp) => {
        if ('documentId' in cp) {
          return documentStorageService().get_document_version(
            cp.documentId,
            cp.documentVersionId
          );
        }
        return { key: cp.documentKey, fileName: cp.fileName };
      })
    );

  // Collect all items to download
  // This can be a sha OR a pdf
  const toDownload = new Set<string>();
  const docxFileBoms: { [path: string]: string }[] = [];
  for (const document of documents) {
    if ('key' in document) {
      toDownload.add(document.key);
      continue;
    }
    if (document.error) {
      logger.error('unable to get document version', {
        ...metadata,
        error: document.error,
        error_message: document.message,
      });
      throw new Error('unable to get document version');
    }
    if (!document.data) {
      logger.error('document data is empty', {
        ...metadata,
        error: document.error,
        error_message: document.message,
      });
      throw new Error('document data is empty');
    }

    const documentMetadata = document.data.documentMetadata;
    if (documentMetadata.fileType === 'docx') {
      const docxFileBom: { [path: string]: string } = {};
      for (const bomPart of documentMetadata.documentBom) {
        docxFileBom[bomPart.path] = bomPart.sha;
        toDownload.add(bomPart.sha);
      }
      docxFileBoms.push(docxFileBom);
    } else {
      toDownload.add(formatPdfKey(documentMetadata));
    }
  }

  const docStorageBucket = config().docStorageBucket;
  const downloadPromises: Promise<{
    key: string;
    data: Uint8Array | undefined;
  }>[] = Array.from(toDownload).map(async (key) => ({
    key,
    data: await s3Client().getObject(docStorageBucket, key),
  }));
  const downloads: { key: string; data: Uint8Array | undefined }[] =
    await Promise.all(downloadPromises);

  if (downloads.filter((d) => d.data === undefined).length > 0) {
    logger.error('failed to download all document parts', {
      ...metadata,
      failed: downloads.filter((d) => d.data === undefined).map((d) => d.key),
    });
    throw new Error('Failed to download all documents');
  }

  // Rebuild documents and create file objects for request
  const fileObjects: File[] = [];
  let documentIndex = 0;
  for (const document of documents) {
    documentIndex++;
    // Handle document being a document key
    if ('key' in document) {
      // get the download
      const download = downloads.find((d) => d.key === document.key);

      if (!download || !download.data) {
        logger.error('failed to find download with key', {
          ...metadata,
          document,
        });
        throw new Error(`Failed to find download with key ${document}`);
      }

      if (document.key.endsWith('.pdf')) {
        const pdf = {
          blob: new Blob([download.data]),
          name: document.fileName,
          type: 'pdf',
        };
        const result = await pdfService().convert(pdf, 'docx');
        if (result.status !== 200) {
          logger.error('failed to convert pdf to docx for compare', {
            ...metadata,
            response: await result.text(),
          });

          throw new PdfServiceError(jobType);
        }

        const blob = await result.blob();

        fileObjects.push({
          blob,
          name: `${document.fileName}-${documentIndex}`,
          type: 'docx',
        });
      } else {
        fileObjects.push({
          blob: new Blob([download.data]),
          name: `${document.fileName}-${documentIndex}`,
          type: 'docx',
        });
      }
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const documentMetadata = document.data!.documentMetadata;
    if (documentMetadata.fileType === 'pdf') {
      const pdfDownload = downloads.find(
        (d) => d.key === formatPdfKey(documentMetadata)
      );
      if (!pdfDownload) {
        logger.error('pdf download not found', {
          ...metadata,
          document,
          key: formatPdfKey(documentMetadata),
        });
        throw new Error('pdf download not found');
      }

      const pdf = {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        blob: new Blob([pdfDownload.data!]),
        name: documentMetadata.documentName,
        type: 'pdf',
      };
      const result = await pdfService().convert(pdf, 'docx');
      if (result.status !== 200) {
        logger.error('failed to convert pdf to docx for compare', {
          ...metadata,
          response: await result.text(),
        });

        throw new PdfServiceError(jobType);
      }

      const blob = await result.blob();

      fileObjects.push({
        blob,
        name: `${documentMetadata.documentName}-${documentIndex}`,
        type: 'docx',
      });
    } else {
      // Docx file
      const zip = new JSZip();
      for (const bomPart of documentMetadata.documentBom) {
        const content: Uint8Array | undefined = downloads.find(
          (d) => d.key === bomPart.sha
        )?.data;
        if (!content) {
          logger.error('failed to find content for bom part', {
            ...metadata,
            document,
            bomPart,
          });
          throw new Error(`Failed to find content for ${bomPart.sha}`);
        }
        zip.file(bomPart.path, content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      fileObjects.push({
        blob,
        name: `${documentMetadata.documentName}-${documentIndex}`,
        type: 'docx',
      });
    }
  }

  return fileObjects;
}

export function formatPdfKey(documentMetadata: {
  owner: string;
  documentId: string;
  documentVersionId: number;
}): string {
  return `${documentMetadata.owner}/${documentMetadata.documentId}/${documentMetadata.documentVersionId}.pdf`;
}
