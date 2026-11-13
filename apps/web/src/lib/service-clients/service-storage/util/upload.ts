import { analytics } from '@app/lib/analytics';
import type { FileTypeString, MimeType } from '@core/block';
import { getFolderZipSha256 } from '@core/client/zipWorkerClient';
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
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import type { ResultError } from '@core/util/result';
import { Telemetry } from '@macro-inc/observability';
import { cachedUserId } from '@queries/auth/cached-user-id';
import { waitForDocumentContentReady } from '@queries/storage/document-location';
import {
  DOCUMENT_NAME_TOO_LONG_CODE,
  storageServiceClient,
} from '@service-storage/client';
import type { UploadFolderProgress } from '@service-storage/generated/schemas/uploadFolderProgress';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import { uploadToPresignedUrl } from '@service-storage/util/uploadToPresignedUrl';
import { storageWS } from '@service-storage/websocket';
import { match } from 'ts-pattern';
import { FileTypeMap } from '../fileTypeMap';
import { waitForFolderUpload } from './folderUploadStatus';
import {
  forgetPendingFolderUpload,
  type PendingFolderUpload,
  readPendingFolderUploads,
  rememberPendingFolderUpload,
} from './pendingFolderUploads';
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
  buffer: Blob;
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
      fireAndForget(
        result.projectId.finally(() => progress?.done()),
        'file-upload'
      );
    } else {
      progress?.done();
    }
    return result;
  } catch (error) {
    progress?.done();
    throw error;
  }
}

async function uploadWithProgress(
  file: File,
  name: string,
  options: UploadFileOptions | undefined,
  progress: UploadProgressHandle | undefined
): Promise<UploadSuccess> {
  const { showPaywall } = usePaywallState();

  // TODO: remove toast logic from dss upload util
  const handleUploadError = (err: ResultError<string>[] | Error | string) => {
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
      fileSize: getUploadFileSize(file),
      destination: 'dss',
      folder: isZip,
    });
  }

  if (isZip && options?.unzipFolder) {
    return uploadFolderZip(file, name, options, progress, handleUploadError);
  }

  let source: UploadSource;
  try {
    source = await resolveUploadSource(file, progress?.preparing);
  } catch (error) {
    return handleUploadError(error instanceof Error ? error : String(error));
  }
  const { sha } = source;
  const putFile = async (presignedUrl: string, type: MimeType) => {
    if (source.kind === 'file') {
      const sent = await uploadWithPresignedUrl({
        presignedUrl,
        buffer: source.file,
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

  const fallbackMime = fileType
    ? (FileTypeMap[fileType as keyof typeof FileTypeMap]?.mime as
        | MimeType
        | undefined)
    : undefined;
  const resolvedContentType = (contentType ||
    fallbackMime ||
    'application/octet-stream') as MimeType;

  if (!(await putFile(presignedUrl, resolvedContentType))) {
    console.error('failed to upload', documentId, 'removing...');
    await storageServiceClient.deleteDocument({ documentId });
    return handleUploadError('Failed to upload file');
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

  return {
    type: 'document',
    name,
    documentId,
    fileType,
  };
}

/**
 * Sends a folder zipped by `zipFiles`. The zip is uploaded straight from the
 * picked files with the hash it was written with, so it is never read whole
 * into memory, then followed through the server's extraction.
 */
async function uploadFolderZip(
  file: File,
  name: string,
  options: UploadFileOptions,
  progress: UploadProgressHandle | undefined,
  handleUploadError: (err: ResultError<string>[] | Error | string) => never
): Promise<PendingFolderUploadResult> {
  const sha = getFolderZipSha256(file);
  if (!sha) return handleUploadError('Folder was not prepared for upload');

  const requestId = await Telemetry.span('folder_upload.send', async (span) => {
    span.setAttr('folder_upload.zip_bytes', file.size);
    const res = await storageServiceClient.projects.createUploadZipRequest({
      sha,
      name,
      parentId: options.projectId,
    });
    if (res.isErr()) {
      return handleUploadError(res.error);
    }

    const { presignedUrl, requestId } = res.value;
    if (!presignedUrl || !requestId) {
      return handleUploadError('Failed to upload zip file');
    }
    span.setAttr('folder_upload.request_id', requestId);

    const sent = await uploadToPresignedUrl({
      presignedUrl,
      buffer: file,
      sha,
      type: 'application/zip',
      onProgress: progress?.sending,
    });
    if (sent.isErr()) {
      return handleUploadError('Failed to upload zip file');
    }
    return requestId;
  });
  progress?.processing(null);

  // Lets a tab opened or reloaded later show how the folder ends.
  const userId = cachedUserId();
  const sentAt = Date.now();
  if (userId) rememberPendingFolderUpload(userId, { requestId, name, sentAt });

  return {
    type: 'folder',
    name,
    requestId,
    projectId: settleFolderUpload(requestId, name, progress, {
      userId,
      sentAt,
      resumed: false,
    }),
  };
}

/** Request ids this tab is following to their end. */
const followedFolderUploads = new Set<string>();

/**
 * Follows the folders this account sent before the page loaded, showing each
 * as Processing until the server says how it ended.
 */
export function resumePendingFolderUploads(userId: string): Promise<void>[] {
  return readPendingFolderUploads(userId)
    .filter((upload) => !followedFolderUploads.has(upload.requestId))
    .map((upload) => followResumedFolderUpload(userId, upload));
}

async function followResumedFolderUpload(
  userId: string,
  upload: PendingFolderUpload
) {
  const progress = trackUpload(upload.name, 0);
  progress.processing(null);
  try {
    await settleFolderUpload(upload.requestId, upload.name, progress, {
      userId,
      sentAt: upload.sentAt,
      resumed: true,
    });
  } finally {
    progress.done();
  }
}

function partialUploadMessage(
  name: string,
  progress: UploadFolderProgress | undefined
): string {
  if (!progress || progress.filesFailed === 0) {
    return `Some files in ${name} could not be uploaded`;
  }
  return `Uploaded ${name}, but ${progress.filesFailed} of ${progress.filesTotal} files could not be uploaded`;
}

/**
 * Waits for the server to finish the folder and tells the user how it ended.
 * Resolves to the created folder's id, or undefined when there is none.
 */
async function settleFolderUpload(
  requestId: string,
  name: string,
  progress: UploadProgressHandle | undefined,
  follow: { userId: string | undefined; sentAt: number; resumed: boolean }
): Promise<string | undefined> {
  followedFolderUploads.add(requestId);
  // A reload resumes the folder, but an automatic one would still interrupt it.
  const releaseReloadHold = holdAutomaticReload();
  try {
    const outcome = await Telemetry.span(
      'folder_upload.server',
      async (span) => {
        span.setAttr('folder_upload.request_id', requestId);
        span.setAttr('folder_upload.resumed', follow.resumed);
        const outcome = await waitForFolderUpload(
          requestId,
          (fraction) => progress?.processing(fraction),
          { sentAt: follow.sentAt }
        );
        span.setAttr('folder_upload.outcome', outcome.status);
        if (outcome.status === 'failed' || outcome.status === 'unknown') {
          span.error(new Error(`folder upload ended ${outcome.status}`));
        }
        return outcome;
      }
    );
    if (follow.userId) forgetPendingFolderUpload(follow.userId, requestId);
    return match(outcome)
      .with({ status: 'completed' }, ({ projectId }) => {
        toast.success(`Uploaded ${name}`);
        return projectId;
      })
      .with({ status: 'partially_completed' }, ({ projectId, progress }) => {
        toast.alert(partialUploadMessage(name, progress));
        return projectId;
      })
      .with({ status: 'failed' }, () => {
        toast.failure(`Failed to upload ${name}`);
        return undefined;
      })
      .with({ status: 'unknown' }, () => {
        // A resumed folder may have been sent long ago; don't promise it soon.
        toast.alert(
          follow.resumed
            ? `Couldn't confirm that ${name} finished uploading. Check Drive.`
            : `Couldn't confirm that ${name} finished uploading. Check Drive in a few minutes.`
        );
        return undefined;
      })
      .exhaustive(() => undefined);
  } finally {
    followedFolderUploads.delete(requestId);
    releaseReloadHold();
  }
}
