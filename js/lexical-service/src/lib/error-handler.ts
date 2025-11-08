import type { Context } from "hono";

export type ErrorStatusCode = 400 | 404 | 500 | 503;

export interface SyncErrorWithStatus extends Error {
  syncStatus?: number;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export class ConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversionError';
  }
}

export function handleEndpointError(error: unknown, c: Context, docId?: string): Response {
  const logContext = docId ? ` for document ${docId}` : '';
  console.error(`Error in endpoint${logContext}:`, error);

  let statusCode: ErrorStatusCode = 500;
  let errorMessage = "Internal server error";

  if (error instanceof Error) {
    const syncStatus = (error as SyncErrorWithStatus).syncStatus;
    if (syncStatus && [404, 503].includes(syncStatus)) {
      statusCode = syncStatus as ErrorStatusCode;
      errorMessage = syncStatus === 404 ? "Document not found" : "Sync service unavailable";
    }
    else if (error instanceof ConfigurationError) {
      statusCode = 500;
      errorMessage = "Service configuration error";
    }
    else if (error instanceof ConversionError) {
      statusCode = 500;
      errorMessage = error.message;
    }
    else if (error.name === 'ZodError') {
      statusCode = 400;
      errorMessage = "Invalid request parameters";
    }
  }

  return c.json({
    error: true,
    message: errorMessage,
  }, { status: statusCode });
}

export function createSyncError(rawDocument: { success: false; error: Error; status?: number }): SyncErrorWithStatus {
  const customError = new Error(rawDocument.error.message) as SyncErrorWithStatus;
  customError.syncStatus = rawDocument.status;
  return customError;
}

export function validateEnvironment(c: Context, requiredVars: string[]): void {
  for (const varName of requiredVars) {
    if (!c.env[varName]) {
      throw new ConfigurationError(`${varName} is not configured`);
    }
  }
}
