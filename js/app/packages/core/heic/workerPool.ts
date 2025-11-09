/**
 * HEIC Worker Pool - Manages worker lifecycle and task distribution
 * Internal implementation detail, not exposed to consumers
 */

import { withAnalytics } from '@coparse/analytics';
import shortUUID from 'short-uuid';
import {
  ERROR_MESSAGES,
  HEIC_MIME_TYPES,
  TASK_ID_PREFIX,
  WORKER_POOL_CONFIG,
} from './constants';
import { EnhancedHeicConversionError, HeicLogger } from './logger';
import { checkWebCodecsSupport } from './utils';

const { track, TrackingEvents } = withAnalytics();

export class HeicConversionError extends Error {
  public originalFilename: string | undefined;

  constructor(originalFilename?: string, message?: string) {
    const errorMessage =
      message ||
      `Failed to convert HEIC file${originalFilename ? ` ${originalFilename}` : ''} to PNG`;
    super(errorMessage);
    this.name = 'HeicConversionError';
    this.originalFilename = originalFilename;

    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      error: this.toString(),
    });
  }
}

// Types for internal worker communication
export interface HeicTaskMessage {
  readonly action: 'convertHeic';
  readonly arrayBuffer: ArrayBuffer;
  readonly format?: string;
  readonly quality?: number;
  readonly type?: string;
  readonly taskId?: string;
  readonly webCodecsSupportedMimeTypes?: string[];
}

export interface HeicProgressData {
  percentage?: number;
  message: string;
}

export interface HeicCompleteData {
  arrayBuffer: ArrayBuffer;
  width: number;
  height: number;
  format: string;
}

export interface HeicErrorData {
  message: string;
}

export interface WorkerMessage {
  taskId: string;
  type: 'progress' | 'complete' | 'error' | 'status';
  data: HeicProgressData | HeicCompleteData | HeicErrorData;
}

interface Task {
  id: string;
  message: HeicTaskMessage;
  onProgress?: (data: HeicProgressData) => void;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  processing: boolean;
}

// Worker wrapper for type-safe communication
class HeicWorkerWrapper {
  worker: Worker;
  id: number;
  busy: boolean;

  constructor(WorkerConstructor: new () => Worker, id: number) {
    this.worker = new WorkerConstructor();
    this.id = id;
    this.busy = false;
  }

  postMessage(message: HeicTaskMessage): void {
    this.worker.postMessage(message);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export class HeicWorkerPool {
  private workerConstructor: new () => Worker;
  private size: number;
  private workers: HeicWorkerWrapper[];
  private taskQueue: Task[];
  private availableWorkers: HeicWorkerWrapper[];
  private static instance: HeicWorkerPool | null = null;
  private static suuidTranslator = shortUUID();
  private webCodecsSupportedMimeTypes: string[] | undefined;

  public static getInstance(
    workerConstructor: new () => Worker,
    size?: number
  ): HeicWorkerPool {
    if (!HeicWorkerPool.instance) {
      HeicWorkerPool.instance = new HeicWorkerPool(workerConstructor, size);
    }
    return HeicWorkerPool.instance;
  }

  private constructor(
    workerConstructor: new () => Worker,
    size = Math.min(
      navigator.hardwareConcurrency || 2,
      WORKER_POOL_CONFIG.MAX_WORKERS
    )
  ) {
    this.workerConstructor = workerConstructor;
    this.size = Math.max(
      WORKER_POOL_CONFIG.MIN_WORKERS,
      Math.min(WORKER_POOL_CONFIG.MAX_WORKERS, size)
    );
    this.workers = [];
    this.taskQueue = [];
    this.availableWorkers = [];

    this.checkWebCodecsSupport().then(() => {
      const supported =
        this.webCodecsSupportedMimeTypes &&
        this.webCodecsSupportedMimeTypes.length > 0;
      if (supported) {
        HeicLogger.info(
          'WebCodecs support detected:',
          this.webCodecsSupportedMimeTypes
        );
      } else {
        HeicLogger.info('WebCodecs support not available');
      }
    });
    this.initialize();
  }

  private async checkWebCodecsSupport(): Promise<void> {
    if (this.webCodecsSupportedMimeTypes) return;

    this.webCodecsSupportedMimeTypes = [];
    for (const mimeType of HEIC_MIME_TYPES) {
      const isSupported = await checkWebCodecsSupport(mimeType);
      if (isSupported) {
        this.webCodecsSupportedMimeTypes.push(mimeType);
      }
    }
  }

  private initialize(): void {
    for (let i = 0; i < this.size; i++) {
      const workerWrapper = new HeicWorkerWrapper(this.workerConstructor, i);

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
              task.onProgress(data as HeicProgressData);
            }
          } else if (type === 'error') {
            const errorData = data as HeicErrorData;
            task.reject(
              new EnhancedHeicConversionError(
                'CONVERSION_FAILED',
                task.message.type,
                new Error(errorData.message)
              )
            );
            this.taskQueue = this.taskQueue.filter((t) => t.id !== taskId);
            workerWrapper.busy = false;
            this.availableWorkers.push(workerWrapper);
            this.processNextTask();
          }
        }
      };

      workerWrapper.worker.onerror = (error: ErrorEvent) => {
        HeicLogger.logWorkerError(i, error);
        const newWorker = new HeicWorkerWrapper(this.workerConstructor, i);
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
          HeicLogger.error(ERROR_MESSAGES.WORKER_NOT_AVAILABLE);
          continue;
        }

        task.processing = true;
        worker.busy = true;

        const message = {
          ...task.message,
          taskId: task.id,
          webCodecsSupportedMimeTypes: this.webCodecsSupportedMimeTypes,
        };

        worker.postMessage(message);
      }
    }
  }

  public addTask(
    message: HeicTaskMessage,
    onProgress?: (data: HeicProgressData) => void
  ): Promise<HeicCompleteData> {
    return new Promise((resolve, reject) => {
      const suuid = HeicWorkerPool.suuidTranslator.generate();
      const taskId = `${TASK_ID_PREFIX}${suuid}`;

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

  public getStats(): { activeWorkers: number; pendingTasks: number } {
    return {
      activeWorkers: this.workers.filter((w) => w.busy).length,
      pendingTasks: this.taskQueue.filter((t) => !t.processing).length,
    };
  }

  public terminate(): void {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.availableWorkers = [];
    HeicWorkerPool.instance = null;
  }
}
