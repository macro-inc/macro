import { withAnalytics } from '@coparse/analytics';
import shortUUID from 'short-uuid';
import ZipWorker from '../../workers/folder-upload/zip-worker?worker';

const { track, TrackingEvents } = withAnalytics();

const MAX_FOLDER_FILE_COUNT = 1000;
// NOTE: you can expect a 30-40% decrease in folder size when zipped
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

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
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

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
    });
  }

  private static toString(limit: number, directoryName: string) {
    return `Folder ${directoryName} exceeds the size limit of ${limit} bytes.`;
  }

  override toString() {
    return DirectoryFileSizeExceededError.toString(
      this.limit,
      this.directoryName
    );
  }
}

// Types for the worker communication
export interface ZipTaskMessage {
  action: 'zipFiles';
  files: File[];
  fileDetails: FileDetail[];
  taskId?: string; // Added by the pool
}

export interface ZipProgressData {
  percentage?: number;
  message: string;
}

export interface ZipCompleteData {
  zipBlob: Blob;
  tempFilename: string;
}

export interface ZipErrorData {
  message: string;
}

export interface WorkerMessage {
  taskId: string;
  type: 'progress' | 'complete' | 'error' | 'status';
  data: ZipProgressData | ZipCompleteData | ZipErrorData;
}

export interface FileDetail {
  path: string;
}

export interface Task {
  id: string;
  message: ZipTaskMessage;
  onProgress?: (data: ZipProgressData) => void;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  processing: boolean;
}

// Worker wrapper to provide type-safe communication
class ZipWorkerWrapper {
  worker: Worker;
  id: number;
  busy: boolean;

  constructor(WorkerConstructor: new () => Worker, id: number) {
    this.worker = new WorkerConstructor();
    this.id = id;
    this.busy = false;
  }

  postMessage(message: ZipTaskMessage): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

const MIN_WORKERS = 2;
const MAX_WORKERS = 6;

export class ZipWorkerPool {
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
      const workerWrapper = new ZipWorkerWrapper(this.workerConstructor, i);

      workerWrapper.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const { taskId, type, data } = event.data;

        const task = this.taskQueue.find((task) => task.id === taskId);

        if (task) {
          if (type === 'complete') {
            task.resolve(data);
            this.taskQueue = this.taskQueue.filter((t) => t.id !== taskId);
            workerWrapper.busy = false;
            this.availableWorkers.push(workerWrapper);
            this.processNextTask();
          } else if (type === 'progress' || type === 'status') {
            if (task.onProgress) {
              task.onProgress(data as ZipProgressData);
            }
          } else if (type === 'error') {
            const errorData = data as ZipErrorData;
            task.reject(new Error(errorData.message));
            this.taskQueue = this.taskQueue.filter((t) => t.id !== taskId);
            workerWrapper.busy = false;
            this.availableWorkers.push(workerWrapper);
            this.processNextTask();
          }
        }
      };

      workerWrapper.worker.onerror = (error: ErrorEvent) => {
        console.error(`Worker ${i} error:`, error);
        const newWorker = new ZipWorkerWrapper(this.workerConstructor, i);
        this.workers[i] = newWorker;

        // If the worker was processing a task, requeue it
        const failedTask = this.taskQueue.find(
          (task) =>
            task.processing &&
            !this.availableWorkers.some((w) => w.busy && w.id === i)
        );

        if (failedTask) {
          failedTask.processing = false;
          this.processNextTask();
        }
      };

      this.workers.push(workerWrapper);
      this.availableWorkers.push(workerWrapper);
    }
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
// empty directories are returned as null
export function handleFoldersInput(
  entries: FileSystemDirectoryEntry[]
): Promise<File | null>[] {
  if (entries.length === 0) {
    return [];
  }

  const zipPromises: Promise<File | null>[] = [];
  for (const entry of entries) {
    const promise = zipDirectory(entry);
    zipPromises.push(promise);
  }

  return zipPromises;
}

// process zip with worker pool
async function zipDirectory(entry: FileSystemDirectoryEntry) {
  const folderName = entry.name;

  const fileEntries: FileSystemFileEntry[] = [];
  const fileDetails: FileDetail[] = [];
  try {
    await processDirectoryEntry(entry, '', fileEntries, fileDetails);
  } catch (error) {
    if (error instanceof DirectoryFileCountExceededError) {
      throw error.setFolderName(folderName);
    }
    throw error;
  }

  if (fileEntries.length === 0) {
    return null;
  } else if (fileEntries.length > MAX_FOLDER_FILE_COUNT) {
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

  const zipFile = await zipFiles(folderName, files, fileDetails);

  return zipFile;
}

// recursively add files to fileEntries and fileDetails from entry
async function processDirectoryEntry(
  entry: FileSystemEntry,
  path: string,
  fileEntries: FileSystemFileEntry[],
  fileDetails: FileDetail[]
): Promise<void> {
  if (entry.isFile) {
    if (fileEntries.length > MAX_FOLDER_FILE_COUNT)
      throw new DirectoryFileCountExceededError();
    fileEntries.push(entry as FileSystemFileEntry);
    fileDetails.push({
      path: path ? `${path}/${entry.name}` : entry.name,
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

    const dirPath = path ? `${path}/${entry.name}` : entry.name;

    for (const childEntry of entries) {
      await processDirectoryEntry(
        childEntry,
        dirPath,
        fileEntries,
        fileDetails
      );
    }
  }
}

export async function zipFiles(
  folderName: string,
  files: File[],
  fileDetails: FileDetail[]
): Promise<File> {
  const workerPool = ZipWorkerPool.getInstance(ZipWorker);

  const message: ZipTaskMessage = {
    action: 'zipFiles',
    files: files,
    fileDetails: fileDetails,
  };

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

  // Add progress tracking
  const onProgress = (_data: ZipProgressData) => {
    // console.log(`Zip progress: ${data.message}`);
  };

  // Add the task to the pool and wait for the result
  const result = await workerPool.addTask(message, onProgress);

  const zipName = `${folderName}.zip`;

  // Create the zip file from the result
  const zipBlob = result.zipBlob;
  const zipFile = new File([zipBlob], zipName, { type: 'application/zip' });

  return zipFile;
}
