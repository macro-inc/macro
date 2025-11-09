/**
 * Constants for HEIC conversion functionality
 */

// Image formats and MIME types
export const IMAGE_FORMATS = {
  PNG: 'image/png',
  JPEG: 'image/jpeg',
  HEIC: 'image/heic',
  HEIF: 'image/heif',
} as const;

export const IMAGE_EXTENSIONS = {
  PNG: 'png',
  JPEG: 'jpg',
  HEIC: 'heic',
  HEIF: 'heif',
} as const;

// Supported HEIC MIME types for detection
export const HEIC_MIME_TYPES = [
  IMAGE_FORMATS.HEIC,
  IMAGE_FORMATS.HEIF,
] as const;
export const HEIC_EXTENSIONS = [
  IMAGE_EXTENSIONS.HEIC,
  IMAGE_EXTENSIONS.HEIF,
] as const;

// Conversion quality settings
export const CONVERSION_QUALITY = {
  HIGH: 0.95,
  STANDARD: 0.92,
  MEDIUM: 0.85,
  LOW: 0.7,
} as const;

// Worker pool configuration
export const WORKER_POOL_CONFIG = {
  MIN_WORKERS: 1,
  MAX_WORKERS: 2, // HEIC conversion is CPU intensive
  DEFAULT_TIMEOUT_MS: 30000, // 30 seconds
} as const;

// Canvas context options
export const CANVAS_OPTIONS = {
  WILL_READ_FREQUENTLY: false,
} as const;

// Task prefixes for ID generation
export const TASK_ID_PREFIX = 'heic-' as const;

// Default conversion settings
export const DEFAULT_CONVERSION_SETTINGS = {
  FORMAT: IMAGE_FORMATS.PNG,
  QUALITY: CONVERSION_QUALITY.STANDARD,
  EXTENSION: IMAGE_EXTENSIONS.PNG,
} as const;

// Error messages
export const ERROR_MESSAGES = {
  NO_IMAGES_FOUND: 'No images found in HEIC file',
  CONVERSION_FAILED: 'HEIC conversion failed',
  PROCESSING_ERROR: 'HEIF processing error',
  WORKER_NOT_AVAILABLE: 'No available HEIC workers',
  WEBCODECS_DECODE_FAILED: 'WebCodecs decode failed',
} as const;

// Log messages
export const LOG_MESSAGES = {
  WEBCODECS_SUPPORT_DETECTED: 'WebCodecs HEIC/HEIF support detected:',
  WEBCODECS_NOT_SUPPORTED: 'WebCodecs available but does not support HEIC/HEIF',
  WEBCODECS_NOT_AVAILABLE: 'WebCodecs ImageDecoder not available',
  WEBCODECS_DECODE_FAILED: 'WebCodecs decode failed',
  CONVERSION_PROGRESS: 'HEIC conversion progress:',
} as const;
