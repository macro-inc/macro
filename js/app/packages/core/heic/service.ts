/**
 * High-level service for HEIC conversion operations
 * Provides a clean API abstraction over the worker pool
 */

import { DEFAULT_CONVERSION_SETTINGS } from './constants';
import HeicWorker from './heic-worker?worker';
import { EnhancedHeicConversionError, HeicLogger } from './logger';
import {
  calculateOptimalWorkerPoolSize,
  chunkFiles,
  isFileSizeReasonable,
  PerformanceMonitor,
} from './performance';
import type { HeicConversionConfig } from './types';
import { generateConvertedFilename, isHeicFile } from './utils';
import { HeicWorkerPool } from './workerPool';

export class HeicConversionService {
  private static instance: HeicConversionService | null = null;
  private workerPool: HeicWorkerPool;

  private constructor() {
    const poolSize = calculateOptimalWorkerPoolSize();
    this.workerPool = HeicWorkerPool.getInstance(HeicWorker, poolSize);
    HeicLogger.info('Initializing HEIC Conversion Service');
  }

  static getInstance(): HeicConversionService {
    if (!HeicConversionService.instance) {
      HeicConversionService.instance = new HeicConversionService();
    }
    return HeicConversionService.instance;
  }

  /**
   * Convert a single HEIC file to the specified format
   */
  async convertFile(
    file: File,
    config: Partial<HeicConversionConfig> = {}
  ): Promise<File> {
    const fullConfig: HeicConversionConfig = {
      format: config.format || DEFAULT_CONVERSION_SETTINGS.FORMAT,
      quality: config.quality || DEFAULT_CONVERSION_SETTINGS.QUALITY,
      timeout: config.timeout,
    };

    // Validate input
    if (!isHeicFile(file)) {
      throw new EnhancedHeicConversionError('CONVERSION_FAILED', file.name);
    }

    if (!isFileSizeReasonable(file)) {
      throw new EnhancedHeicConversionError('CONVERSION_FAILED', file.name);
    }

    return PerformanceMonitor.measureAsync(`convert-${file.name}`, () =>
      this.performConversion(file, fullConfig)
    );
  }

  /**
   * Convert multiple HEIC files with optimal batching
   */
  async convertFiles(
    files: File[],
    config: Partial<HeicConversionConfig> = {}
  ): Promise<File[]> {
    const heicFiles = files.filter(isHeicFile);

    if (heicFiles.length === 0) {
      return files;
    }

    HeicLogger.info(`Converting ${heicFiles.length} HEIC files in batches`);

    // Process in chunks to avoid overwhelming the worker pool
    const chunks = chunkFiles(heicFiles, 3);
    const convertedResults: File[] = [];

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map((file) => this.convertFile(file, config))
      );
      convertedResults.push(...chunkResults);
    }

    // Maintain original order
    const resultMap = new Map(
      convertedResults.map((file) => [
        file.name.replace(/\.(png|jpg)$/, ''), // Remove added extension
        file,
      ])
    );

    return files.map((file) => {
      if (isHeicFile(file)) {
        const baseName = file.name.replace(/\.(heic|heif)$/i, '');
        return resultMap.get(baseName) || file;
      }
      return file;
    });
  }

  /**
   * Check if a file can be converted
   */
  canConvert(file: File): boolean {
    return isHeicFile(file) && isFileSizeReasonable(file);
  }

  /**
   * Get conversion statistics
   */
  getStats(): { activeWorkers: number; pendingTasks: number } {
    return this.workerPool.getStats();
  }

  /**
   * Clean shutdown
   */
  shutdown(): void {
    this.workerPool.terminate();
    HeicConversionService.instance = null;
  }

  private async performConversion(
    file: File,
    config: HeicConversionConfig
  ): Promise<File> {
    const arrayBuffer = await file.arrayBuffer();

    const result = await this.workerPool.addTask({
      action: 'convertHeic',
      arrayBuffer,
      format: config.format,
      quality: config.quality,
      type: file.type,
    });

    const convertedName = generateConvertedFilename(file.name, config.format);
    const convertedBlob = new Blob([result.arrayBuffer], {
      type: config.format,
    });
    const convertedFile = new File([convertedBlob], convertedName, {
      type: config.format,
    });

    HeicLogger.logConversionComplete(convertedName);
    return convertedFile;
  }
}

// Export a singleton instance for convenience
export const heicConversionService = HeicConversionService.getInstance();
