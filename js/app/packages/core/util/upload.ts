/**
 * Unified Upload Module
 *
 * Centralizes all upload operations to DSS and Static File Service
 * with standardized validation, conversion, and error handling. Browser `File`s
 * stay as the public API; upload internals normalize them into `UploadFile`s
 * where native staged files need special handling.
 */

import { analytics } from '@app/lib/analytics';
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
import {
  createStaticUploadFile,
  createUploadFile,
  isNativeStagedUpload,
  type UploadFile,
} from '@core/util/uploadFile';
import {
  fileExtension,
  filenameWithoutExtension,
} from '@service-storage/util/filename';
import {
  type UploadFileOptions as DssUploadFileOptions,
  type UploadSuccess as DssUploadSuccessResult,
  upload as dssUpload,
} from '@service-storage/util/upload';
import { toast } from 'core/component/Toast/Toast';

const MAX_FILE_BYTE_SIZE = 2 * 1000 * 1000 * 1000; // 2GB

type UploadDestination = 'dss' | 'static';

type UploadPickerCleanup = () => void;

type UploadPickerOptions = {
  multiple?: boolean;
  acceptedMimeTypes?: string[];
  acceptedFileExtensions?: string[];
  directory?: boolean;
  filterDotfiles?: boolean;
};

function buildAcceptString(options?: UploadPickerOptions): string {
  const mimeTypes = options?.acceptedMimeTypes?.join(',');
  const fileExtensions = options?.acceptedFileExtensions?.join(',.');
  let acceptString = '';
  if (mimeTypes) {
    acceptString += `${mimeTypes},`;
  }
  if (fileExtensions) {
    acceptString += `.${fileExtensions}`;
  }
  return acceptString;
}

function filterFilesFromInput(
  fileList: FileList | null,
  options?: UploadPickerOptions
): File[] {
  const filterDotfiles = options?.filterDotfiles ?? true;
  const files = Array.from(fileList || []);
  return filterDotfiles ? files.filter((f) => !f.name.startsWith('.')) : files;
}

function createHiddenFileInput(
  options?: UploadPickerOptions
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  input.multiple = options?.multiple ?? false;
  input.accept = buildAcceptString(options);

  // Enable folder picking in browsers that support it (Safari/Chrome/WebKit)
  if (options?.directory) {
    // property exists in TS lib for WebKit dir inputs on some setups
    (
      input as HTMLInputElement & { webkitdirectory?: boolean }
    ).webkitdirectory = true;
    // ensure attribute is present for environments that rely on it
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
  }

  return input;
}

/**
 * Imperative picker for files/folders, using a hidden <input type="file" />.
 * Returns a cleanup function; you generally don't need it because the util
 * removes listeners and DOM nodes once a selection is made.
 */
function openUploadPicker(
  options: UploadPickerOptions,
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  const input = createHiddenFileInput(options);

  const handleChange = () => {
    const files = filterFilesFromInput(input.files, options);
    // Always cleanup before invoking callback to avoid re-entrancy leaks
    cleanup();
    // Only call onSelect if there are files selected
    if (files.length > 0) {
      void onSelect(files);
    }
  };

  const cleanup = () => {
    input.removeEventListener('change', handleChange);
    input.remove();
  };

  input.addEventListener('change', handleChange);
  document.body.appendChild(input);
  input.click();

  return cleanup;
}

export function openFilePicker(
  options: Omit<UploadPickerOptions, 'directory'> = {},
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  return openUploadPicker(
    {
      ...options,
      directory: false,
    },
    onSelect
  );
}

export function openFolderPicker(
  options: Omit<UploadPickerOptions, 'directory'> = {},
  onSelect: (files: File[]) => void | Promise<void>
): UploadPickerCleanup {
  return openUploadPicker(
    {
      ...options,
      directory: true,
      multiple: options.multiple ?? true,
    },
    onSelect
  );
}

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
  | ((file: UploadFile) => UploadDestination);

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
type UploadFileEntry = {
  file: File;
  isFolder: boolean;
};

export type UploadInput = File | UploadFileEntry;

const getFileName = (file: { name: string }) =>
  filenameWithoutExtension(file.name) ?? file.name;

export const isFileUploadEntry = (file: UploadInput): file is UploadFileEntry =>
  'isFolder' in file;

const getDestination = (file: UploadFile, ruleset: DestinationRuleset) => {
  return ruleset instanceof Function ? ruleset(file) : ruleset;
};

const DEFAULT_DESTINATION_RULESET: DestinationRuleset = 'dss';

// Shared ruleset for chat input -> images/videos are static for inline display, everything else to DSS
export const chatRuleset: DestinationRuleset = (file: UploadFile) => {
  const fileType = blockAcceptedMimetypeToFileExtension[file.mimeType];
  const ext = fileExtension(file.name);

  // Images go to static for inline display
  if (
    file.mimeType.startsWith('image/') ||
    file.mimeType.startsWith('video/') ||
    blockAcceptsFileExtension('image', fileType) ||
    blockAcceptsFileExtension('video', fileType) ||
    (ext && blockAcceptsFileExtension('image', ext)) ||
    (ext && blockAcceptsFileExtension('video', ext))
  ) {
    return 'static';
  }

  return 'dss';
};

// Ruleset that forces an upload to dss.
export const forceDssRuleset: DestinationRuleset = (_: UploadFile) => 'dss';

class FileSizeExceededError extends Error {
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

    analytics.track('upload_error', {
      type: this.name,
    });
  }

  private static toString(sizeString: string, fileName: string) {
    return `File ${fileName} exceeds the size limit of ${sizeString}.`;
  }

  toString() {
    return FileSizeExceededError.toString(this.sizeString, this.fileName);
  }
}

class UnsupportedFileTypeError extends Error {
  public fileName: string;
  public fileType: string;

  constructor(fileName: string, fileType: string) {
    const message = `File type ${fileType} is not supported for ${fileName}`;
    super(message);
    this.name = 'UnsupportedFileTypeError';
    this.fileName = fileName;
    this.fileType = fileType;

    analytics.track('upload_error', {
      type: this.name,
    });
  }
}

class UploadError extends Error {
  constructor(
    file: { name: string },
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

    analytics.track('upload_error', {
      type: this.name,
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

function validateFileSize(file: UploadFile): void {
  if (file.size > MAX_FILE_BYTE_SIZE) {
    throw new FileSizeExceededError(getFileName(file));
  }
}

// Pre-upload processing for browser-backed files. Native staged uploads have
// already been encoded/staged by native code, and their JS `File` is only a
// placeholder, so browser-side conversions must not run on them.
async function processFile(file: UploadFile): Promise<UploadFile> {
  if (file.kind === 'browser' && heicConversionService.canConvert(file.file)) {
    return createUploadFile(await heicConversionService.convertFile(file.file));
  }
  return file;
}

async function uploadToDSS(
  file: UploadFile,
  options: DssUploadFileOptions
): Promise<DssUploadSuccessResult> {
  if (isNativeStagedUpload(file)) {
    throw new UploadError(
      file,
      'dss',
      'Native staged uploads require static upload'
    );
  }

  try {
    return dssUpload(file.file, options);
  } catch (error) {
    throw new UploadError(file, 'dss', error);
  }
}

async function uploadToStatic(
  file: UploadFile
): Promise<StaticUploadSuccessResult> {
  const name = getFileName(file);
  try {
    // `createStaticUploadFile` is the single static-file path for UploadFile:
    // browser files are PUT from JS; native staged files are PUT from Rust using
    // the staged token and the presigned URL requested inside that helper.
    const id = await createStaticUploadFile(file);
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
  const uploadSource = createUploadFile(file);
  try {
    validateFileSize(uploadSource);

    const processedFile = await processFile(uploadSource);

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
    const name = getFileName(uploadSource);
    return {
      failed: true,
      error:
        error instanceof Error
          ? error
          : new UploadError(uploadSource, 'dss', error),
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

  const entries = fileList.map((file) =>
    isFileUploadEntry(file) ? file : { file, isFolder: false }
  );
  const files = entries.map((entry) => entry.file);
  const uploadSources = files.map(createUploadFile);

  // validate all files before uploading
  for (const file of uploadSources) {
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
    const isFolder = entries[index].isFolder;
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
