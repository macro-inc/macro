import { withAnalytics } from '@coparse/analytics';
import { ERROR_MESSAGES, LOG_MESSAGES } from './constants';

const { track, TrackingEvents } = withAnalytics();

/**
 * Centralized logging utilities for HEIC conversion
 */

export class HeicLogger {
  private static readonly PREFIX = '[HEIC]';

  static info(message: string, ...args: any[]): void {
    console.log(`${this.PREFIX} ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    console.warn(`${this.PREFIX} ${message}`, ...args);
  }

  static error(message: string, error?: Error | unknown, ...args: any[]): void {
    console.error(`${this.PREFIX} ${message}`, error, ...args);
  }

  static debug(message: string, ...args: any[]): void {
    if (process.env.NODE_ENV === 'development') {
      console.debug(`${this.PREFIX} ${message}`, ...args);
    }
  }

  // Predefined log methods for common scenarios
  static logWebCodecsSupport(supportedTypes: string[]): void {
    this.info(LOG_MESSAGES.WEBCODECS_SUPPORT_DETECTED, supportedTypes);
  }

  static logWebCodecsNotSupported(): void {
    this.info(LOG_MESSAGES.WEBCODECS_NOT_SUPPORTED);
  }

  static logWebCodecsNotAvailable(): void {
    this.info(LOG_MESSAGES.WEBCODECS_NOT_AVAILABLE);
  }

  static logWebCodecsDecodeFailed(mimeType: string, error: Error): void {
    this.warn(
      `${LOG_MESSAGES.WEBCODECS_DECODE_FAILED} with ${mimeType}:`,
      error.message
    );
  }

  static logConversionError(error: Error): void {
    this.error('HEIC conversion error:', error);
  }

  static logWorkerError(workerId: number, error: ErrorEvent): void {
    this.error(`HEIC Worker ${workerId} error:`, error);
  }

  static logConversionComplete(filename: string): void {
    this.debug(`Converted HEIC file: ${filename}`);
  }
}

/**
 * Enhanced error class with better context and logging
 */
export class EnhancedHeicConversionError extends Error {
  public readonly originalFilename?: string;
  public readonly errorCode: string;
  public readonly timestamp: Date;

  constructor(
    errorCode: keyof typeof ERROR_MESSAGES,
    originalFilename?: string,
    cause?: Error
  ) {
    const message = ERROR_MESSAGES[errorCode];
    const fullMessage = originalFilename
      ? `${message} (file: ${originalFilename})`
      : message;

    super(fullMessage);

    this.name = 'HeicConversionError';
    this.originalFilename = originalFilename;
    this.errorCode = errorCode;
    this.timestamp = new Date();
    this.cause = cause;

    // Log the error immediately
    HeicLogger.error(fullMessage, cause);

    // Track error in analytics
    track(TrackingEvents.UPLOAD.ERROR, {
      type: this.name,
      errorCode: this.errorCode,
      filename: this.originalFilename,
      error: this.toString(),
    });
  }
}
