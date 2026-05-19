export {


  DEFAULT_CONVERSION_SETTINGS,
  ERROR_MESSAGES,
  HEIC_EXTENSIONS,
  HEIC_MIME_TYPES,

  IMAGE_FORMATS,
  LOG_MESSAGES,
  TASK_ID_PREFIX,
  WORKER_POOL_CONFIG,
} from './constants';

export {
  calculateOptimalWorkerPoolSize,
  chunkFiles,


  isFileSizeReasonable,
  PerformanceMonitor,
} from './performance';

export type {
  ConversionQuality,


  HeicConversionConfig,
  SupportedImageFormat,


} from './types';
export {
  checkWebCodecsSupport,
  isHeicFile,
} from './utils';

export type {




} from './workerPool';
