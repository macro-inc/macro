import type { IMAGE_FORMATS } from './constants';

/**
 * Supported image formats for HEIC conversion
 */
export type SupportedImageFormat =
  (typeof IMAGE_FORMATS)[keyof typeof IMAGE_FORMATS];

/**
 * HEIC conversion quality levels
 */
export type ConversionQuality = 0.7 | 0.85 | 0.92 | 0.95;

/**
 * Task status in the worker pool
 */
export type TaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Worker message types
 */
export type WorkerMessageType = 'progress' | 'complete' | 'error' | 'status';

/**
 * Configuration for HEIC conversion
 */
export interface HeicConversionConfig {
  readonly format: SupportedImageFormat;
  readonly quality: ConversionQuality;
  readonly timeout?: number;
}

/**
 * Result of a successful HEIC conversion
 */
export interface ConversionResult {
  readonly arrayBuffer: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly format: SupportedImageFormat;
  readonly originalFilename?: string;
  readonly convertedFilename: string;
}

/**
 * Enhanced task interface with better typing
 */
export interface EnhancedTask {
  readonly id: string;
  readonly filename: string;
  readonly status: TaskStatus;
  readonly startTime: Date;
  readonly config: HeicConversionConfig;
  endTime?: Date;
  error?: Error;
}
