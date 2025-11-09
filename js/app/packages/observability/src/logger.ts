import { datadogLogs } from '@datadog/browser-logs';
import { isInitialized } from './shared';

interface Context {
  error?: Error;
  level?: 'debug' | 'info' | 'warn' | 'error';
  [key: string]: any;
}

/**
 * Log a message to Datadog.
 * @param messsage - The message to log.
 * @param context - The context of the log such as error, level, etc.
 */
export function log(messsage: string, context?: Context) {
  if (import.meta.hot || !isInitialized())
    return console.log(messsage, context);

  const { error, level, ...messageContext } = {
    error: undefined,
    level: 'info',
    ...context,
  } as const;

  datadogLogs.logger.log(messsage, messageContext, level, error);
}

interface ErrorContext extends Context {
  cause?: Error;
}

/**
 * Log a warning to Datadog.
 * @param message - The message to log.
 * @param context - The context of the log such as error, level, etc.
 */
export function warn(message: string, context?: Context) {
  if (import.meta.hot || !isInitialized())
    return console.warn(message, context);

  const { error, level, ...messageContext } = {
    error: undefined,
    level: 'warn',
    ...context,
  } as const;

  datadogLogs.logger.log(message, messageContext, level, error);
}

/**
 * Log an error to Datadog.
 * @param errorMessage - The Error object or message to log.
 * @param context - The context of the log such as cause, level, etc.
 *
 * If used in a catch block, set the context.cause to the error thrown.
 */
export function error(errorMessage: Error | string, context?: ErrorContext) {
  if (import.meta.hot || !isInitialized())
    return console.error(errorMessage, context);

  const { error, ...errorContext } = {
    error:
      typeof errorMessage === 'string' ? new Error(errorMessage) : errorMessage,
    level: 'error',
    ...context,
  } as const;

  if (context?.cause) {
    error.cause = context.cause;
  }

  datadogLogs.logger.error(error.message || error.name, errorContext, error);
}

export const logger = {
  log,
  warn,
  error,
};
