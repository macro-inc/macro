import {
  type ResultError,
  type ResultType,
  ThrownResultError,
  throwOnErr,
} from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import { DocumentContentState } from '@service-storage/generated/schemas/documentContentState';
import { type Result, err, ok } from 'neverthrow';
import { queryClient } from '../client';
import { documentLocationKeys } from './keys';

type DocumentLocationArgs = {
  documentId: string;
  versionId?: number;
};

type GetDocumentLocationResult = Awaited<
  ReturnType<typeof storageServiceClient.getDocumentLocation>
>;

type DocumentLocation = ResultType<GetDocumentLocationResult>['data'];

type WaitForDocumentLocationOptions = {
  target: string;
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  isReady: (location: DocumentLocation) => boolean;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_INITIAL_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 1_000;

class DocumentLocationNotReadyError extends Error {
  constructor(public readonly location: DocumentLocation) {
    super('Document location is not ready');
    this.name = 'DocumentLocationNotReadyError';
  }
}

function retryDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number
) {
  return Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
}

function documentLocationQueryOptions(args: DocumentLocationArgs) {
  return {
    queryKey: documentLocationKeys.location(args.documentId, args.versionId)
      .queryKey,
    queryFn: () => requestDocumentLocation(args),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  };
}

async function requestDocumentLocation(
  args: DocumentLocationArgs
): Promise<DocumentLocation> {
  return throwOnErr(async () =>
    storageServiceClient.getDocumentLocation(args)
  ).then((result) => result.data);
}

/**
 * Fetches the current document location through TanStack Query, deduping with
 * the readiness-wait helpers that share the same cache key.
 */
export async function fetchDocumentLocation(
  args: DocumentLocationArgs
): Promise<Result<DocumentLocation, ResultError<string>[]>> {
  try {
    return ok(await queryClient.fetchQuery(documentLocationQueryOptions(args)));
  } catch (error) {
    if (error instanceof ThrownResultError) return err(error.errors);
    throw error;
  }
}

function invalidateDocumentLocation(args: DocumentLocationArgs) {
  storageServiceClient.getDocumentLocation.invalidate({
    documentId: args.documentId,
  });
  if (args.versionId != null) {
    storageServiceClient.getDocumentLocation.invalidate(args);
  }

  return queryClient.invalidateQueries({
    queryKey: documentLocationKeys.location(args.documentId, args.versionId)
      .queryKey,
  });
}

async function waitForDocumentLocation(
  args: DocumentLocationArgs,
  options: WaitForDocumentLocationOptions
): Promise<DocumentLocation> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const deadline = Date.now() + timeoutMs;
  let lastLocation: DocumentLocation | undefined;

  try {
    return await queryClient.fetchQuery({
      queryKey: documentLocationKeys.wait(
        args.documentId,
        args.versionId,
        options.target,
        timeoutMs
      ).queryKey,
      queryFn: async () => {
        await invalidateDocumentLocation(args);
        const location = await requestDocumentLocation(args);
        lastLocation = location;

        if (!options.isReady(location)) {
          throw new DocumentLocationNotReadyError(location);
        }

        queryClient.setQueryData(
          documentLocationKeys.location(args.documentId, args.versionId)
            .queryKey,
          location
        );

        return location;
      },
      retry: (_failureCount, error) =>
        error instanceof DocumentLocationNotReadyError && Date.now() < deadline,
      retryDelay: (attempt) => retryDelay(attempt, initialDelayMs, maxDelayMs),
      staleTime: 0,
      gcTime: 0,
    });
  } catch (error) {
    if (error instanceof DocumentLocationNotReadyError) {
      return error.location;
    }
    if (lastLocation) return lastLocation;
    throw error;
  }
}

export function waitForDocumentContentReady(
  args: DocumentLocationArgs & {
    timeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<DocumentLocation> {
  const { timeoutMs, initialDelayMs, maxDelayMs, ...locationArgs } = args;
  return waitForDocumentLocation(locationArgs, {
    target: 'content-ready',
    timeoutMs,
    initialDelayMs,
    maxDelayMs,
    isReady: (location) =>
      location.content.state === DocumentContentState.ready,
  });
}

export function waitForDocumentSyncServiceReady(
  args: DocumentLocationArgs & {
    timeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<DocumentLocation> {
  const { timeoutMs, initialDelayMs, maxDelayMs, ...locationArgs } = args;
  return waitForDocumentLocation(locationArgs, {
    target: 'sync-service-ready',
    timeoutMs,
    initialDelayMs,
    maxDelayMs,
    isReady: (location) =>
      location.content.state === DocumentContentState.ready &&
      location.type === 'syncServiceContent',
  });
}

export function waitForDocumentPresignedUrlReady(
  args: DocumentLocationArgs & {
    timeoutMs?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
  }
): Promise<DocumentLocation> {
  const { timeoutMs, initialDelayMs, maxDelayMs, ...locationArgs } = args;
  return waitForDocumentLocation(locationArgs, {
    target: 'presigned-url-ready',
    timeoutMs,
    initialDelayMs,
    maxDelayMs,
    isReady: (location) =>
      location.content.state === DocumentContentState.ready &&
      location.type === 'presignedUrl',
  });
}

function _locationToAppResult(
  location: DocumentLocation
): Result<{ data: DocumentLocation }, ResultError<string>[]> {
  return ok({ data: location });
}

function isDocumentLocationReady(location: DocumentLocation) {
  return location.content.state === DocumentContentState.ready;
}

function _isDocumentLocationResultReady(
  result: Result<{ data: DocumentLocation }, ResultError<string>[]>
) {
  return !result.isErr() && isDocumentLocationReady(result.value.data);
}
