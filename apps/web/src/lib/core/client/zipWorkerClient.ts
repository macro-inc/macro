import { analytics } from '@app/lib/analytics';
import {
  trackUpload,
  type UploadProgressHandle,
} from '@core/component/UploadProgress/uploadProgress';
import { humanFileSize } from '@core/util/humanFileSize';
import { holdAutomaticReload } from '@core/util/reloadForNewerBuild';
import { Telemetry } from '@macro-inc/observability';
import shortUUID from 'short-uuid';
import { match } from 'ts-pattern';
import type {
  ZipWorkerRequest,
  ZipWorkerResponse,
} from '../../workers/folder-upload/zip-worker';
import ZipWorker from '../../workers/folder-upload/zip-worker?worker';
import { joinZipPath } from './folderUploadPaths';

const MAX_FOLDER_FILE_COUNT = 10_000;
// Folders are zipped without compression, so this is also the upload's size.
const MAX_FOLDER_BYTE_SIZE = 3 * 1000 * 1000 * 1000; // 3GB

export class DirectoryFileCountExceededError extends Error {
  public limit: number;
  public directoryName: string | undefined;
  public count: number | undefined;

  constructor(
    directoryName?: string,
    count?: number,
    limit = MAX_FOLDER_FILE_COUNT
  ) {
    const message = DirectoryFileCountExceededError.toString(
      limit,
      directoryName,
      count
    );
    super(message);
    this.limit = limit;
    this.name = 'DirectoryFileCountExceededError';
    this.directoryName = directoryName;
    this.count = count;

    analytics.track('upload_error', {
      type: this.name,
    });
  }

  setFolderName(folderName: string) {
    this.directoryName = folderName;
    return this;
  }

  private static toString(
    limit: number,
    directoryName?: string,
    count?: number
  ) {
    if (directoryName && count) {
      return `Folder ${directoryName} has ${count} files. Limit: ${limit} files.`;
    } else if (directoryName) {
      return `Folder ${directoryName} exceeds the file count limit of ${limit} files.`;
    } else if (count) {
      return `Folder has ${count} files. Limit: ${limit} files.`;
    }
    return `Folder exceeds the file count limit of ${limit} files.`;
  }

  override toString() {
    return DirectoryFileCountExceededError.toString(
      this.limit,
      this.directoryName,
      this.count
    );
  }
}

export class DirectoryFileSizeExceededError extends Error {
  public limit: number;
  public directoryName: string;

  constructor(directoryName: string, limit = MAX_FOLDER_BYTE_SIZE) {
    const message = DirectoryFileSizeExceededError.toString(
      limit,
      directoryName
    );
    super(message);
    this.name = 'DirectoryFileSizeExceededError';
    this.directoryName = directoryName;
    this.limit = limit;

    analytics.track('upload_error', {
      type: this.name,
    });
  }

  private static toString(limit: number, directoryName: string) {
    return `Folder ${directoryName} exceeds the size limit of ${humanFileSize(limit)}.`;
  }

  override toString() {
    return DirectoryFileSizeExceededError.toString(
      this.limit,
      this.directoryName
    );
  }
}

type ZipTaskMessage = Omit<ZipWorkerRequest, 'taskId'>;

type ZipProgressData = Extract<ZipWorkerResponse, { type: 'progress' }>['data'];

type ZipCompleteData = Extract<ZipWorkerResponse, { type: 'complete' }>['data'];

export interface FileDetail {
  path: string;
}

interface Task {
  id: string;
  message: ZipTaskMessage;
  onProgress?: (data: ZipProgressData) => void;
  resolve: (value: ZipCompleteData) => void;
  reject: (reason: Error) => void;
  processing: boolean;
}

// Worker wrapper to provide type-safe communication
class ZipWorkerWrapper {
  worker: Worker;
  id: number;
  busy: boolean;
  /** The task this worker is running, if any. */
  taskId: string | undefined;

  constructor(WorkerConstructor: new () => Worker, id: number) {
    this.worker = new WorkerConstructor();
    this.id = id;
    this.busy = false;
    this.taskId = undefined;
  }

  postMessage(message: ZipWorkerRequest): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

const MIN_WORKERS = 2;
const MAX_WORKERS = 6;

class ZipWorkerPool {
  private workerConstructor: new () => Worker;
  private size: number;
  private workers: ZipWorkerWrapper[];
  private taskQueue: Task[];
  private availableWorkers: ZipWorkerWrapper[];
  private static instance: ZipWorkerPool | null = null;
  private static suuidTranslator = shortUUID();

  public static getInstance(
    workerConstructor: new () => Worker,
    size?: number
  ): ZipWorkerPool {
    if (!ZipWorkerPool.instance) {
      ZipWorkerPool.instance = new ZipWorkerPool(workerConstructor, size);
    }
    return ZipWorkerPool.instance;
  }

  private constructor(
    workerConstructor: new () => Worker,
    size = navigator.hardwareConcurrency || 4
  ) {
    this.workerConstructor = workerConstructor;
    this.size = Math.max(MIN_WORKERS, Math.min(MAX_WORKERS, size));
    this.workers = [];
    this.taskQueue = [];
    this.availableWorkers = [];

    this.initialize();
  }

  private initialize(): void {
    for (let i = 0; i < this.size; i++) {
      const workerWrapper = this.createWorker(i);
      this.workers.push(workerWrapper);
      this.availableWorkers.push(workerWrapper);
    }
  }

  private createWorker(index: number): ZipWorkerWrapper {
    const workerWrapper = new ZipWorkerWrapper(this.workerConstructor, index);

    const finish = (task: Task) => {
      this.taskQueue = this.taskQueue.filter((t) => t.id !== task.id);
      workerWrapper.busy = false;
      workerWrapper.taskId = undefined;
      this.availableWorkers.push(workerWrapper);
      this.processNextTask();
    };

    workerWrapper.worker.onmessage = (
      event: MessageEvent<ZipWorkerResponse>
    ) => {
      const response = event.data;
      const task = this.taskQueue.find((task) => task.id === response.taskId);
      if (!task) return;

      match(response)
        .with({ type: 'complete' }, ({ data }) => {
          task.resolve(data);
          finish(task);
        })
        .with({ type: 'progress' }, ({ data }) => task.onProgress?.(data))
        .with({ type: 'error' }, ({ data }) => {
          task.reject(new Error(data.message));
          finish(task);
        })
        .exhaustive((unknown) =>
          console.warn('zip worker: unknown response', unknown)
        );
    };

    // A worker that fails to load or crashes never answers again: fail its
    // task, so the folder's indicator and reload hold end, and replace it.
    workerWrapper.worker.onerror = (error: ErrorEvent) => {
      console.error(`Worker ${index} error:`, error);
      const task = this.taskQueue.find((t) => t.id === workerWrapper.taskId);
      if (task) {
        task.reject(
          new Error(error.message || 'The folder could not be zipped')
        );
        this.taskQueue = this.taskQueue.filter((t) => t.id !== task.id);
      }

      workerWrapper.terminate();
      const replacement = this.createWorker(index);
      this.workers[index] = replacement;
      this.availableWorkers = [
        ...this.availableWorkers.filter((w) => w !== workerWrapper),
        replacement,
      ];
      this.processNextTask();
    };

    return workerWrapper;
  }

  private processNextTask(): void {
    // If there are pending tasks and available workers, assign tasks
    if (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const pendingTasks = this.taskQueue.filter((task) => !task.processing);

      for (
        let i = 0;
        i < Math.min(pendingTasks.length, this.availableWorkers.length);
        i++
      ) {
        const task = pendingTasks[i];
        const worker = this.availableWorkers.shift();
        if (!worker) {
          console.error('No available workers');
          continue;
        }

        task.processing = true;
        worker.busy = true;
        worker.taskId = task.id;

        const message = {
          ...task.message,
          taskId: task.id,
        };

        worker.postMessage(message);
      }
    }
  }

  public addTask(
    message: ZipTaskMessage,
    onProgress?: (data: ZipProgressData) => void
  ): Promise<ZipCompleteData> {
    return new Promise((resolve, reject) => {
      const suuid = ZipWorkerPool.suuidTranslator.generate();
      const taskId = `zip-${suuid}`;

      this.taskQueue.push({
        id: taskId,
        message,
        onProgress,
        resolve,
        reject,
        processing: false,
      });

      this.processNextTask();
    });
  }

  public terminate(): void {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
    ZipWorkerPool.instance = null;
  }
}

// zips up each folder entry and returns the zip files
export function handleFoldersInput(
  entries: FileSystemDirectoryEntry[]
): Promise<File>[] {
  if (entries.length === 0) {
    return [];
  }

  const zipPromises: Promise<File>[] = [];
  for (const entry of entries) {
    const promise = zipDirectory(entry);
    zipPromises.push(promise);
  }

  return zipPromises;
}

/**
 * Shows the folder in the upload indicator while it is read and zipped, and
 * keeps the tab from reloading into a newer build, which would discard it.
 */
async function prepareFolder(
  folderName: string,
  prepare: (progress: UploadProgressHandle) => Promise<File>
): Promise<File> {
  const progress = trackUpload(folderName, 0);
  const releaseReloadHold = holdAutomaticReload();
  try {
    return await prepare(progress);
  } finally {
    progress.done();
    releaseReloadHold();
  }
}

// process zip with worker pool
function zipDirectory(entry: FileSystemDirectoryEntry) {
  return prepareFolder(entry.name, (progress) =>
    zipDirectoryEntries(entry, progress)
  );
}

async function zipDirectoryEntries(
  entry: FileSystemDirectoryEntry,
  progress: UploadProgressHandle
) {
  const folderName = entry.name;

  const fileEntries: FileSystemFileEntry[] = [];
  const fileDetails: FileDetail[] = [];
  const folderPaths: string[] = [];
  try {
    await processDirectoryEntry(
      entry,
      '',
      fileEntries,
      fileDetails,
      folderPaths
    );
  } catch (error) {
    if (error instanceof DirectoryFileCountExceededError) {
      throw error.setFolderName(folderName);
    }
    throw error;
  }

  // A folder with no files still uploads, so its (empty) folders are created.
  if (fileEntries.length > MAX_FOLDER_FILE_COUNT) {
    throw new DirectoryFileCountExceededError(folderName, fileEntries.length);
  }

  let totalBytes = 0;
  const filePromises = fileEntries.map(
    (entry) =>
      new Promise<File>((resolve, reject) => {
        entry.file(
          (file) => {
            totalBytes += file.size;
            if (totalBytes > MAX_FOLDER_BYTE_SIZE) {
              reject(new DirectoryFileSizeExceededError(folderName));
            }
            resolve(file);
          },
          (error) => reject(error)
        );
      })
  );

  const files = await Promise.all(filePromises);

  return writeFolderZip(folderName, files, fileDetails, folderPaths, progress);
}

// recursively add files to fileEntries and fileDetails from entry
async function processDirectoryEntry(
  entry: FileSystemEntry,
  path: string,
  fileEntries: FileSystemFileEntry[],
  fileDetails: FileDetail[],
  folderPaths: string[]
): Promise<void> {
  if (entry.isFile) {
    if (fileEntries.length > MAX_FOLDER_FILE_COUNT)
      throw new DirectoryFileCountExceededError();
    fileEntries.push(entry as FileSystemFileEntry);
    fileDetails.push({
      path: joinZipPath(path, entry.name),
    });
  } else if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    let entries: FileSystemEntry[] = [];

    const readEntriesBatch = (): Promise<FileSystemEntry[]> => {
      return new Promise<FileSystemEntry[]>((resolve, reject) => {
        dirReader.readEntries(resolve, reject);
      });
    };

    // The API might not return all entries in a single call for large directories
    // We need to keep calling until an empty array is returned
    let batch: FileSystemEntry[] = [];
    do {
      try {
        batch = await readEntriesBatch();
        entries = entries.concat(batch);
      } catch (error) {
        console.error(`Error reading directory ${entry.name}:`, error);
        throw error;
      }
    } while (batch.length > 0);

    const dirPath = joinZipPath(path, entry.name);
    folderPaths.push(dirPath);

    for (const childEntry of entries) {
      await processDirectoryEntry(
        childEntry,
        dirPath,
        fileEntries,
        fileDetails,
        folderPaths
      );
    }
  }
}

// The SHA-256 each folder zip was written with, so uploading one never reads
// it into memory to hash it.
const folderZipHashes = new WeakMap<File, string>();

/** The SHA-256 of a zip made by `zipFiles`, or undefined for any other file. */
export function getFolderZipSha256(file: File): string | undefined {
  return folderZipHashes.get(file);
}

export function zipFiles(
  folderName: string,
  files: File[],
  fileDetails: FileDetail[],
  folderPaths: string[] = []
): Promise<File> {
  return prepareFolder(folderName, (progress) =>
    writeFolderZip(folderName, files, fileDetails, folderPaths, progress)
  );
}

async function writeFolderZip(
  folderName: string,
  files: File[],
  fileDetails: FileDetail[],
  folderPaths: string[],
  progress: UploadProgressHandle
): Promise<File> {
  // check file count
  if (files.length > MAX_FOLDER_FILE_COUNT) {
    throw new DirectoryFileCountExceededError(folderName, files.length);
  }

  // check file size
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (totalBytes > MAX_FOLDER_BYTE_SIZE) {
      throw new DirectoryFileSizeExceededError(folderName);
    }
  }

  return Telemetry.span('folder_upload.zip', async (span) => {
    span.setAttr('folder_upload.files', files.length);
    span.setAttr('folder_upload.folders', folderPaths.length);
    span.setAttr('folder_upload.bytes', totalBytes);

    const workerPool = ZipWorkerPool.getInstance(ZipWorker);
    const result = await workerPool.addTask(
      { action: 'zipFiles', files, fileDetails, folderPaths },
      ({ processedBytes, totalBytes }) =>
        progress.preparing(totalBytes > 0 ? processedBytes / totalBytes : null)
    );
    span.setAttr('folder_upload.zip_bytes', result.zipBlob.size);

    const zipFile = new File([result.zipBlob], `${folderName}.zip`, {
      type: 'application/zip',
    });
    folderZipHashes.set(zipFile, result.sha256);
    return zipFile;
  });
}
