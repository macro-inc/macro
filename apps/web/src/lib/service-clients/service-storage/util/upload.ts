import { analytics } from '@app/lib/analytics';
import type { FileTypeString, MimeType } from '@core/block';
import { toast } from '@core/component/Toast/Toast';
import {
  trackUpload,
  type UploadProgressHandle,
} from '@core/component/UploadProgress/uploadProgress';
import { blockAcceptedMimetypeToFileExtension } from '@core/constant/allBlocks';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import {
  getUploadFileSize,
  nativeUploadChecksum,
  resolveUploadSource,
  type UploadSource,
  uploadNativeStagedFileToPresignedUrl,
} from '@core/mobile/nativeStagedUpload';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ResultError } from '@core/util/result';
import { waitForDocumentContentReady } from '@queries/storage/document-location';
import { waitBulkUploadStatus } from '@service-connection/bulkUpload';
import {
  DOCUMENT_NAME_TOO_LONG_CODE,
  storageServiceClient,
} from '@service-storage/client';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { storageWS } from '@service-storage/websocket';
import { FileTypeMap } from '../fileTypeMap';
import { uploadDocx } from './uploadDocx';

/**
 * Thrown when the backend rejects a document name as too long. Carries the
 * limit so the UI can render its own copy without hardcoding the number.
 */
export class DocumentNameTooLongError extends Error {
  constructor(public readonly maxLength?: number) {
    super('Document name too long');
    this.name = 'DocumentNameTooLongError';
  }
}

const uploadWithPresignedUrl = async (params: {
  presignedUrl: string;
  buffer: ArrayBuffer;
  sha: string;
  type: MimeType;
  onProgress?: (sent: number | null) => void;
}) => {
  const uploadResult = await uploadToPresignedUrl(params);
  return !uploadResult.isErr();
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
  const name = filenameWithoutExtension(file.name) ?? file.name;
  const progress = options?.hideProgressIndicator
    ? undefined
    : trackUpload(name, getUploadFileSize(file));

  try {
    const result = await uploadWithProgress(file, name, options, progress);
    if (result.type === 'folder') {
      // The server keeps unpacking the folder after the zip is sent.
      const { projectId } = result;
      const finishWhenUnpacked = async () => {
        try {
          await projectId;
        } finally {
          progress?.done();
        }
      };
      fireAndForget(finishWhenUnpacked(), 'file-upload');
    } else {
      progress?.done();
    }
    return result;
  } catch (error) {
    progress?.done();
    throw error;
  }
}

// TODO: remove toast logic from dss upload util
function handleUploadError(err: ResultError<string>[] | Error | string): never {
  if (Array.isArray(err) && err[0]?.code === DOCUMENT_NAME_TOO_LONG_CODE) {
    let maxLength: number | undefined;
    try {
      maxLength = (JSON.parse(err[0].message) as { maxLength?: number })
        .maxLength;
    } catch {
      maxLength = undefined;
    }
    throw new DocumentNameTooLongError(maxLength);
  }

  const isPaywallError = Array.isArray(err) && err[0].message.includes('403');

  if (isPaywallError) {
    usePaywallState().showPaywall(PaywallKey.FILE_LIMIT);
    throw new Error('Forbidden');
  }

  const errorMessage = Array.isArray(err)
    ? err[0].message
    : err instanceof Error
      ? err.message
      : err;

  throw new Error(errorMessage);
}

function resolveFileTypeOrExtension(
  file: File,
  fileType: FileTypeString | undefined
): string {
  // Many file types have "" as the mimeType on upload
  // In that case, we default to the file extension as the fileType
  return (
    fileType ||
    blockAcceptedMimetypeToFileExtension[file.type as MimeType] ||
    file.name.split('.').pop()?.toLowerCase() ||
    ''
  );
}

function resolveContentType(
  contentType: string | null | undefined,
  fileType: string | null | undefined
): MimeType {
  const fallbackMime = fileType
    ? (FileTypeMap[fileType as keyof typeof FileTypeMap]?.mime as
        | MimeType
        | undefined)
    : undefined;
  return (contentType ||
    fallbackMime ||
    'application/octet-stream') as MimeType;
}

type PutFile = (presignedUrl: string, type: MimeType) => Promise<boolean>;

async function uploadZipAsFolder(
  sha: string,
  name: string,
  parentId: string | undefined,
  putFile: PutFile
): Promise<PendingFolderUploadResult> {
  const res = await storageServiceClient.projects.createUploadZipRequest({
    sha,
    name,
    parentId,
  });
  if (res.isErr()) {
    return handleUploadError(res.error);
  }

  const { presignedUrl, requestId } = res.value;

  if (
    !presignedUrl ||
    !requestId ||
    !(await putFile(presignedUrl, 'application/zip'))
  ) {
    return handleUploadError('Failed to upload zip file');
  }

  const projectIdPromise = waitBulkUploadStatus(requestId);
  const announceResult = async () => {
    if (await projectIdPromise) {
      toast.success(`Uploaded ${name}`);
    } else {
      toast.failure(`Failed to upload ${name}`);
    }
  };
  fireAndForget(announceResult(), 'file-upload');

  return {
    type: 'folder',
    name,
    requestId,
    projectId: projectIdPromise,
  };
}

async function warnIfContentNotReady(
  documentId: string,
  versionId: number,
  fileType: FileTypeString | undefined
) {
  let contentState: string | undefined;
  try {
    const location = await waitForDocumentContentReady({
      documentId,
      versionId,
    });
    contentState = location.content.state;
  } catch (error) {
    console.warn('failed while waiting for document upload readiness', error);
  }
  if (contentState !== 'ready') {
    console.warn('document upload did not become ready before timeout', {
      documentId,
      fileType,
    });
  }
}

async function uploadWithProgress(
  file: File,
  name: string,
  options: UploadFileOptions | undefined,
  progress: UploadProgressHandle | undefined
): Promise<UploadSuccess> {
  // Determine file type and mime type
  const fileTypeOrExtension = resolveFileTypeOrExtension(
    file,
    options?.fileType
  );
  const isZip = fileTypeOrExtension === 'zip';

  if (!options?.skipAnalytics) {
    analytics.track('upload_file', {
      fileType: fileTypeOrExtension,
      fileName: file.name,
      fileSize: getUploadFileSize(file),
      destination: 'dss',
      folder: isZip,
    });
  }

  let source: UploadSource;
  try {
    source = await resolveUploadSource(file);
  } catch (error) {
    return handleUploadError(error instanceof Error ? error : String(error));
  }
  const { sha } = source;
  const putFile: PutFile = async (presignedUrl, type) => {
    if (source.kind === 'bytes') {
      const sent = await uploadWithPresignedUrl({
        presignedUrl,
        buffer: source.buffer,
        sha,
        type,
        onProgress: progress?.sending,
      });
      if (sent) progress?.processing();
      return sent;
    }
    // The native transport doesn't report bytes sent.
    progress?.sending(null);
    try {
      await uploadNativeStagedFileToPresignedUrl(
        { ...source.staged, mimeType: type },
        presignedUrl,
        nativeUploadChecksum(sha)
      );
      progress?.processing();
      return true;
    } catch (error) {
      console.error('Native staged upload failed', error);
      return false;
    }
  };

  if (isZip && options?.unzipFolder) {
    return uploadZipAsFolder(sha, name, options.projectId, putFile);
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
      return handleUploadError('Failed to upload docx file');
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

  if (newfile.isErr()) {
    return handleUploadError(newfile.error);
  }

  const { metadata, presignedUrl, contentType, fileType } = newfile.value;
  const { documentId, documentVersionId } = metadata;

  if (
    !(await putFile(presignedUrl, resolveContentType(contentType, fileType)))
  ) {
    console.error('failed to upload', documentId, 'removing...');
    await storageServiceClient.deleteDocument({ documentId });
    return handleUploadError('Failed to upload file');
  }

  // Document upload finalization is owned by the backend S3 ObjectCreated
  // pipeline. The event finalizer marks object-storage documents uploaded and
  // initializes markdown documents in sync-service.
  if (fileType !== 'docx') {
    await warnIfContentNotReady(documentId, documentVersionId, fileType);
  }

  if (docxProcessingPromise) {
    await docxProcessingPromise;
  }

  return {
    type: 'document',
    name,
    documentId,
    fileType,
  };
}
