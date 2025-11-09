export {
  CANVAS_OPTIONS,
  CONVERSION_QUALITY,
  DEFAULT_CONVERSION_SETTINGS,
  ERROR_MESSAGES,
  HEIC_EXTENSIONS,
  HEIC_MIME_TYPES,
  IMAGE_EXTENSIONS,
  IMAGE_FORMATS,
  LOG_MESSAGES,
  TASK_ID_PREFIX,
  WORKER_POOL_CONFIG,
} from './constants';
export { EnhancedHeicConversionError, HeicLogger } from './logger';
export {
  calculateOptimalWorkerPoolSize,
  chunkFiles,
  estimateConversionTime,
  getOptimizedCanvasOptions,
  isFileSizeReasonable,
  PerformanceMonitor,
} from './performance';
export { HeicConversionService, heicConversionService } from './service';
export type {
  ConversionQuality,
  ConversionResult,
  EnhancedTask,
  HeicConversionConfig,
  SupportedImageFormat,
  TaskStatus,
  WorkerMessageType,
} from './types';
export {
  checkWebCodecsSupport,
  isHeicFile,
} from './utils';

export type {
  HeicCompleteData,
  HeicErrorData,
  HeicProgressData,
  HeicTaskMessage,
} from './workerPool';
