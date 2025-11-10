/**
 * Unified Upload Module
 *
 * Centralizes all upload operations to DSS and Static File Service
 * with standardized validation, conversion, and error handling.
 */

import { withAnalytics } from '@coparse/analytics';
import {
  DirectoryFileCountExceededError,
  DirectoryFileSizeExceededError,
  type FileDetail,
  handleFoldersInput,
  zipFiles,
} from '@core/client/zipWorkerClient';
import {
  blockAcceptedMimetypeToFileExtension,
  blockAcceptsFileExtension,
} from '@core/constant/allBlocks';
import { heicConversionService } from '@core/heic/service';
import { createStaticFile } from '@core/util/create';
import { filenameWithoutExtension } from '@service-storage/util/filename';
import {
  type UploadFileOptions as DssUploadFileOptions,
  type UploadSuccess as DssUploadSuccessResult,
  upload as dssUpload,
} from '@service-storage/util/upload';
import { toast } from 'core/component/Toast/Toast';

const { track, TrackingEvents } = withAnalytics();

const MAX_FILE_BYTE_SIZE = 2 * 1000 * 1000 * 1000; // 2GB

type UploadDestination = 'dss' | 'static';

type StaticUploadSuccessResult = {
  name: string;
  id: string;
};

type Dss<T> = { destination: 'dss' } & T;

type Static<T> = { destination: 'static' } & T;

type Success<T> = { failed: false; pending: boolean } & T;

type Failure<T> = { failed: true } & T;

type UploadFailure = Failure<{ error: Error; name: string }>;

type DestinationUploadResult =
  | Dss<DssUploadSuccessResult>
  | Static<StaticUploadSuccessResult>;

type MaybeUploadResult = Success<DestinationUploadResult> | UploadFailure;

type DestinationRuleset<D extends UploadDestination = UploadDestination> =
  | D
  | ((file: File) => UploadDestination);

type ExtractDestination<T> = T extends UploadDestination
  ? T
  : UploadDestination;

type UploadFileResult<D extends UploadDestination> = D extends 'dss'
  ? Success<Dss<DssUploadSuccessResult>> | UploadFailure
  : D extends 'static'
    ? Success<Static<StaticUploadSuccessResult>> | UploadFailure
    : MaybeUploadResult;

type DssUploadFilesOptions = Omit<DssUploadFileOptions, 'unzipFolder'>;

/** regular file or a directory that was zipped */
export type UploadFileEntry = {
  file: File;
  isFolder: boolean;
};

export type UploadInput = File | UploadFileEntry;

const getFileName = (file: File) =>
  filenameWithoutExtension(file.name) ?? file.name;

const isFileUploadEntry = (
  file: File | UploadFileEntry
): file is UploadFileEntry => 'isFolder' in file;

const getDestination = (file: File, ruleset: DestinationRuleset) => {
  return ruleset instanceof Function ? ruleset(file) : ruleset;
};

const DEFAULT_DESTINATION_RULESET: DestinationRuleset = 'dss';

// Shared ruleset for chat input -> images/videos are static for inline display, everything else to DSS
export const chatRuleset: DestinationRuleset = (file: File) => {
  const fileType = blockAcceptedMimetypeToFileExtension[file.type];

  // Images go to static for inline display
  if (
    file.type.startsWith('image/') ||
    file.type.startsWith('video/') ||
    blockAcceptsFileExtension('image', fileType) ||
    blockAcceptsFileExtension('video', fileType)
  ) {
    return 'static';
  }

  // Everything else goes to DSS for document features
  return 'dss';
};

// Ruleset that forces an upload to dss.
export const forceDssRuleset: DestinationRuleset = (_: File) => 'dss';

export class FileSizeExceededError extends Error {
  public limit: number;
  public fileName: string;
  private sizeString: string;

  constructor(fileName: string, limit = MAX_FILE_BYTE_SIZE) {
    const sizeString = humanFileSize(limit);
    const message = FileSizeExceededError.toString(sizeString, fileName);
    super(message);
    this.name = 'FileSizeExceededError';
    this.limit = limit;
    this.fileName = fileName;
    this.sizeString = sizeString;

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
    });
  }

  private static toString(sizeString: string, fileName: string) {
    return `File ${fileName} exceeds the size limit of ${sizeString}.`;
  }

  toString() {
    return FileSizeExceededError.toString(this.sizeString, this.fileName);
  }
}

export class UnsupportedFileTypeError extends Error {
  public fileName: string;
  public fileType: string;

  constructor(fileName: string, fileType: string) {
    const message = `File type ${fileType} is not supported for ${fileName}`;
    super(message);
    this.name = 'UnsupportedFileTypeError';
    this.fileName = fileName;
    this.fileType = fileType;

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
    });
  }
}

export class UploadError extends Error {
  constructor(
    file: File,
    destination?: UploadDestination,
    originalError?: Error | string
  ) {
    const fileName = getFileName(file);
    const message = `Upload failed: ${fileName}`;
    super(message);

    console.error(
      `upload${destination ? ` to ${destination}` : ''} failed:`,
      originalError
    );

    this.name = 'UploadError';

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
      destination,
    });
  }

  toString() {
    return this.message;
  }
}

function humanFileSize(bytes: number, si = true, dp = 1): string {
  const thresh = si ? 1000 : 1024;

  if (Math.abs(bytes) < thresh) {
    return bytes + ' B';
  }

  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
  let u = -1;
  const r = 10 ** dp;

  do {
    bytes /= thresh;
    ++u;
  } while (
    Math.round(Math.abs(bytes) * r) / r >= thresh &&
    u < units.length - 1
  );

  return `${parseFloat(bytes.toFixed(dp))} ${units[u]}`;
}

function validateFileSize(file: File): void {
  if (file.size > MAX_FILE_BYTE_SIZE) {
    throw new FileSizeExceededError(getFileName(file));
  }
}

// pre-upload processing (if needed). Currently only used for HEIC conversion
async function processFile(file: File): Promise<File> {
  if (heicConversionService.canConvert(file)) {
    return await heicConversionService.convertFile(file);
  }
  return file;
}

async function uploadToDSS(
  file: File,
  options: DssUploadFileOptions
): Promise<DssUploadSuccessResult> {
  try {
    return dssUpload(file, options);
  } catch (error) {
    throw new UploadError(file, 'dss', error);
  }
}

async function uploadToStatic(file: File): Promise<StaticUploadSuccessResult> {
  const name = getFileName(file);
  try {
    const id = await createStaticFile(file);
    return {
      name,
      id,
    };
  } catch (error) {
    throw new UploadError(file, 'static', error);
  }
}

export function uploadFile<D extends UploadDestination = UploadDestination>(
  file: File,
  destinationRuleset: DestinationRuleset<D>,
  options?: DssUploadFileOptions
): Promise<UploadFileResult<ExtractDestination<D>>>;

export async function uploadFile(
  file: File,
  destinationRuleset: DestinationRuleset,
  dssOptions: DssUploadFileOptions = {}
): Promise<MaybeUploadResult> {
  try {
    validateFileSize(file);

    const processedFile = await processFile(file);

    const destination = destinationRuleset
      ? getDestination(processedFile, destinationRuleset)
      : getDestination(processedFile, DEFAULT_DESTINATION_RULESET);

    let result: DestinationUploadResult;
    let pending = false;
    if (destination === 'static') {
      const data = await uploadToStatic(processedFile);
      result = {
        destination: 'static',
        ...data,
      };
    } else {
      const data = await uploadToDSS(processedFile, dssOptions);
      result = {
        destination: 'dss',
        ...data,
      };
      if (data.type === 'folder') pending = true;
    }

    return { failed: false, pending, ...result };
  } catch (error) {
    const name = getFileName(file);
    return {
      failed: true,
      error:
        error instanceof Error ? error : new UploadError(file, 'dss', error),
      name,
    };
  }
}

export function uploadFiles<D extends UploadDestination = UploadDestination>(
  fileList: UploadInput[],
  destinationRuleset: DestinationRuleset<D>,
  dssOptions?: DssUploadFilesOptions
): Promise<UploadFileResult<ExtractDestination<D>>[]>;

/** Supports both regular files and zipped folder uploads */
export async function uploadFiles(
  fileList: UploadInput[],
  destinationRuleset: DestinationRuleset,
  dssOptions: DssUploadFilesOptions = {}
): Promise<MaybeUploadResult[]> {
  if (fileList.length === 0) {
    return [];
  }

  const files = fileList.map((file) => {
    return isFileUploadEntry(file) ? file.file : file;
  });

  // validate all files before uploading
  for (const file of files) {
    try {
      validateFileSize(file);
    } catch (error) {
      if (error instanceof FileSizeExceededError) {
        handleUploadError(error);
        throw error;
      }
    }
  }

  const uploadPromises = files.map((file, index) => {
    const isFolder =
      isFileUploadEntry(fileList[index]) && fileList[index].isFolder;
    const uploadOptions: DssUploadFileOptions = isFolder
      ? {
          ...dssOptions,
          unzipFolder: true,
        }
      : dssOptions;
    return uploadFile(file, destinationRuleset, uploadOptions);
  });

  const results = await Promise.allSettled(uploadPromises);

  const uploadResults: MaybeUploadResult[] = results.map((result, index) => {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      const file = files[index];
      const error = result.reason;
      let name = getFileName(file);
      return {
        failed: true,
        error: new UploadError(file, undefined, error),
        name,
      };
    }
  });

  const successfulUploads = uploadResults
    .filter((result) => !result.failed)
    .filter((result) => !result.pending);

  successfulUploads.forEach((result) => {
    toast.success(`Uploaded ${result.name}`);
  });

  const failedUploads = uploadResults.filter((result) => result.failed);

  failedUploads.forEach((result) => {
    handleUploadError(result.error);
  });

  return uploadResults;
}

function handleUploadError(error: Error): void {
  console.error('Upload error:', error);
  if (
    error instanceof UploadError ||
    error instanceof FileSizeExceededError ||
    error instanceof UnsupportedFileTypeError ||
    error instanceof DirectoryFileCountExceededError ||
    error instanceof DirectoryFileSizeExceededError
  ) {
    toast.failure(error.toString());
  } else {
    toast.failure('Upload failed. Please try again.');
  }
}

function mapFileEntriesToFiles(
  entries: FileSystemFileEntry[]
): Promise<File>[] {
  if (entries.length === 0) {
    return [];
  }

  return entries.map(
    (entry) =>
      new Promise<File>((resolve, reject) => {
        entry.file(
          (file) => resolve(file),
          (error) => reject(error)
        );
      })
  );
}

export async function handleFileFolderDrop(
  fileEntries: FileSystemFileEntry[],
  folderEntries: FileSystemDirectoryEntry[],
  onFilesReady: (files: UploadFileEntry[]) => void | Promise<void>
): Promise<void> {
  const filesPromise = mapFileEntriesToFiles(fileEntries).map(
    async (filePromise) => {
      const file = await filePromise;
      if (!file) return;
      return {
        file,
        isFolder: false,
      };
    }
  );
  const zipFilesPromise = handleFoldersInput(folderEntries).map(
    async (filePromise) => {
      const file = await filePromise;
      if (!file) return;
      return {
        file,
        isFolder: true,
      };
    }
  );

  const resultPromise = Promise.allSettled([
    ...filesPromise,
    ...zipFilesPromise,
  ]);

  if (folderEntries.length > 0) {
    toast.promise(resultPromise, {
      loading: 'Preparing folder upload...',
    });
  }

  const results = await resultPromise;

  const uploadFiles: UploadFileEntry[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const entry = result.value;
      if (entry) {
        uploadFiles.push(entry);
      }
    } else if (result.status === 'rejected') {
      const error = result.reason;
      handleUploadError(
        error instanceof Error ? error : new Error('Failed to process')
      );
    }
  }

  await onFilesReady(uploadFiles);
}

export async function handleFolderSelect(
  files: File[],
  onFilesReady: (files: UploadFileEntry[]) => void | Promise<void>
): Promise<void> {
  const groups = new Map<string, { files: File[]; details: FileDetail[] }>();
  for (const file of files) {
    const rel = file.webkitRelativePath || file.name;
    const parts = rel.split('/');
    const top = parts.shift() || file.name;
    const path = parts.join('/');
    const group = groups.get(top) || {
      files: [],
      details: [],
    };
    group.files.push(file);
    group.details.push({ path: path || file.name });
    groups.set(top, group);
  }

  const zipEntryPromises = Array.from(groups.entries()).map(
    ([folderName, group]) =>
      zipFiles(folderName, group.files, group.details).then((zip) => ({
        file: zip,
        isFolder: true,
      }))
  );

  const resultPromise = Promise.allSettled(zipEntryPromises);

  if (zipEntryPromises.length > 0) {
    toast.promise(resultPromise, {
      loading: 'Preparing folder upload...',
    });
  }

  const results = await resultPromise;

  const uploadFiles: UploadFileEntry[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const entry = result.value;
      if (entry) {
        uploadFiles.push(entry);
      }
    } else if (result.status === 'rejected') {
      const error = result.reason;
      handleUploadError(
        error instanceof Error ? error : new Error('Failed to process')
      );
    }
  }

  await onFilesReady(uploadFiles);
}
