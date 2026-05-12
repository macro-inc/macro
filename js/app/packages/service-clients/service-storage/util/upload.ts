import { analytics } from '@app/lib/analytics';
import type { FileTypeString, MimeType } from '@core/block';
import { blockAcceptedMimetypeToFileExtension } from '@core/constant/allBlocks';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { contentHash } from '@core/util/hash';
import { isErr, type ResultError } from '@core/util/maybeResult';
import { toaster } from '@kobalte/core/toast';
import { waitForDocumentContentReady } from '@queries/storage/document-location';
import { waitBulkUploadStatus } from '@service-connection/bulkUpload';
import { storageServiceClient } from '@service-storage/client';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { storageWS } from '@service-storage/websocket';
import { createUploadToast, toast } from 'core/component/Toast/Toast';
import { FileTypeMap } from '../fileTypeMap';
import { uploadDocx } from './uploadDocx';

const dismissToast = (toastId: number | null) => {
  if (toastId !== null) toaster.dismiss(toastId);
};

const uploadWithPresignedUrl = async (params: {
  presignedUrl: string;
  buffer: ArrayBuffer;
  sha: string;
  type: MimeType;
}) => {
  const uploadResult = await uploadToPresignedUrl(params);
  return !isErr(uploadResult);
};

type DocumentUploadResult = {
  type: 'document';
  name: string;
  documentId: string;
  fileType: FileTypeString | undefined;
};

type PendingFolderUploadResult = {
  type: 'folder';
  name: string;
  requestId: string;
  projectId: Promise<string | undefined>;
};

export type UploadSuccess = DocumentUploadResult | PendingFolderUploadResult;

export type UploadFileOptions = {
  // upload to a specific project
  projectId?: string;
  // hide the upload progress indicator toast
  hideProgressIndicator?: boolean;
  // skip waiting for docx processing before returning success response (i.e. unzipping bom parts or pdf conversion)
  skipWaitForDocxProcessing?: boolean;
  // skip analytics tracking
  skipAnalytics?: boolean;
  // if a zip file is uploaded, extract as a folder
  unzipFolder?: boolean;
  // maps to a preferred dss file type
  fileType?: FileTypeString;
};

/** @internal you should be using core/util/upload */
export async function upload(
  file: File,
  options?: UploadFileOptions
): Promise<UploadSuccess> {
  const { showPaywall } = usePaywallState();

  // TODO: remove toast logic from dss upload util
  const handleUploadError = (
    err: ResultError<string>[] | Error | string,
    toastId: number | null
  ) => {
    dismissToast(toastId);

    const isPaywallError = Array.isArray(err) && err[0].message.includes('403');

    if (isPaywallError) {
      showPaywall(PaywallKey.FILE_LIMIT);
      throw new Error('Forbidden');
    }

    const errorMessage = Array.isArray(err)
      ? err[0].message
      : err instanceof Error
        ? err.message
        : err;

    throw new Error(errorMessage);
  };

  const { type: mimeType } = file;

  // Determine file type and mime type
  let fileTypeOrExtension =
    options?.fileType || blockAcceptedMimetypeToFileExtension[mimeType];
  const fileExtension = file.name.split('.').pop()?.toLowerCase();

  // Many file types have "" as the mimeType on upload
  // In that case, we default to the file extension as the fileType
  if (!fileTypeOrExtension) {
    fileTypeOrExtension = fileExtension ?? '';
  }
  const isZip = fileTypeOrExtension === 'zip';

  if (!options?.skipAnalytics) {
    analytics.track('upload_file', {
      fileType: fileTypeOrExtension,
      fileName: file.name,
      fileSize: file.size,
      destination: 'dss',
      folder: isZip,
    });
  }

  let name = filenameWithoutExtension(file.name) ?? file.name;

  // Create toast notification if needed
  const toastId = !options?.hideProgressIndicator
    ? createUploadToast(`Uploading ${name}`)
    : null;

  const buffer = await file.arrayBuffer();
  const sha = await contentHash(buffer);

  if (isZip && options?.unzipFolder) {
    const res = await storageServiceClient.projects.createUploadZipRequest({
      sha,
      name,
      parentId: options?.projectId,
    });
    if (isErr(res)) {
      return handleUploadError(res[0], toastId);
    }

    const { presignedUrl, requestId } = res[1];

    if (
      !presignedUrl ||
      !requestId ||
      !(await uploadWithPresignedUrl({
        presignedUrl,
        buffer,
        sha,
        type: 'application/zip',
      }))
    ) {
      return handleUploadError('Failed to upload zip file', toastId);
    }

    const projectIdPromise = waitBulkUploadStatus(requestId);

    // Wait for upload status and dismiss toast when complete
    projectIdPromise.then((projectId) => {
      if (projectId) {
        toast.success(`Uploaded ${name}`);
      } else {
        toast.failure(`Failed to upload ${name}`);
      }
      dismissToast(toastId);
    });

    return {
      type: 'folder',
      name,
      requestId,
      projectId: projectIdPromise,
    };
  }

  // Handle docx file upload
  let jobId: string | undefined;
  let docxProcessingPromise: Promise<boolean | undefined> | undefined;
  if (fileTypeOrExtension === 'docx') {
    const [uploadJobPromise, processingPromise] = uploadDocx(
      storageWS.underlyingWebsocket
    );

    jobId = await uploadJobPromise;
    if (jobId == null) {
      console.error('failed to upload docx', sha);
      return handleUploadError('Failed to upload docx file', toastId);
    }
    if (!options?.skipWaitForDocxProcessing)
      docxProcessingPromise = processingPromise;
  }

  // Create document
  const newfile = await storageServiceClient.createDocument({
    sha,
    documentName: file.name,
    jobId,
    projectId: options?.projectId,
    fileType: options?.fileType,
  });

  if (isErr(newfile)) {
    return handleUploadError(newfile[0], toastId);
  }

  const [, { metadata, presignedUrl, contentType, fileType }] = newfile;
  const { documentId, documentVersionId } = metadata;

  const fallbackMime = fileType
    ? (FileTypeMap[fileType as keyof typeof FileTypeMap]?.mime as
        | MimeType
        | undefined)
    : undefined;
  const resolvedContentType = (contentType ||
    fallbackMime ||
    'application/octet-stream') as MimeType;

  if (
    !(await uploadWithPresignedUrl({
      presignedUrl,
      buffer,
      sha,
      type: resolvedContentType,
    }))
  ) {
    console.error('failed to upload', documentId, 'removing...');
    await storageServiceClient.deleteDocument({ documentId });
    return handleUploadError('Failed to upload file', toastId);
  }

  // Document upload finalization is owned by the backend S3 ObjectCreated
  // pipeline. The event finalizer marks object-storage documents uploaded and
  // initializes markdown documents in sync-service.
  if (fileType !== 'docx') {
    const readyLocation = await waitForDocumentContentReady({
      documentId,
      versionId: documentVersionId,
    }).catch((error) => {
      console.warn('failed while waiting for document upload readiness', error);
      return undefined;
    });
    if (readyLocation?.content.state !== 'ready') {
      console.warn('document upload did not become ready before timeout', {
        documentId,
        fileType,
      });
    }
  }

  if (docxProcessingPromise) {
    await docxProcessingPromise;
  }

  dismissToast(toastId);

  return {
    type: 'document',
    name,
    documentId,
    fileType,
  };
}
