/**
 * Performance utilities for HEIC conversion
 */

import { WORKER_POOL_CONFIG } from './constants';

/**
 * Calculate optimal worker pool size based on device capabilities
 */
export function calculateOptimalWorkerPoolSize(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory || 4; // GB, fallback to 4GB

  // HEIC conversion is memory intensive, adjust based on available memory
  let optimalSize = Math.min(cores, WORKER_POOL_CONFIG.MAX_WORKERS);

  // Reduce workers for low-memory devices
  if (memory < 4) {
    optimalSize = Math.min(optimalSize, 1);
  } else if (memory < 8) {
    optimalSize = Math.min(optimalSize, 2);
  }

  return Math.max(WORKER_POOL_CONFIG.MIN_WORKERS, optimalSize);
}

/**
 * Check if file size is reasonable for conversion
 */
export function isFileSizeReasonable(file: File): boolean {
  const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  return file.size <= MAX_FILE_SIZE;
}

/**
 * Estimate conversion time based on file size
 */
export function estimateConversionTime(fileSizeBytes: number): number {
  // Rough estimate: 1MB = 1 second on average hardware
  const sizeInMB = fileSizeBytes / (1024 * 1024);
  return Math.ceil(sizeInMB * 1000); // Return in milliseconds
}

/**
 * Create optimized canvas context options based on use case
 */
export function getOptimizedCanvasOptions(willReadPixels: boolean = false) {
  return {
    willReadFrequently: willReadPixels,
    alpha: true,
    colorSpace: 'srgb' as PredefinedColorSpace,
  };
}

/**
 * Chunk large file arrays for batch processing
 */
export function chunkFiles(files: File[], chunkSize: number = 3): File[][] {
  const chunks: File[][] = [];
  for (let i = 0; i < files.length; i += chunkSize) {
    chunks.push(files.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Performance monitoring utilities
 */
export class PerformanceMonitor {
  private static measurements = new Map<string, number>();

  static startMeasurement(key: string): void {
    this.measurements.set(key, performance.now());
  }

  static endMeasurement(key: string): number {
    const startTime = this.measurements.get(key);
    if (!startTime) return 0;

    const duration = performance.now() - startTime;
    this.measurements.delete(key);
    return duration;
  }

  static measureAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
    this.startMeasurement(key);
    return fn().finally(() => {
      const duration = this.endMeasurement(key);
      console.debug(`[HEIC Performance] ${key}: ${duration.toFixed(2)}ms`);
    });
  }
}
