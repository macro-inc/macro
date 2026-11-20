import { type LoadErrors, loadResult } from '@core/block';
import { catchToResult, type ResultError, throwOnErr } from '@core/util/result';
import { cacheSessionGeneration } from '@graphql-cache/session-generation';
import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import type { Result } from 'neverthrow';
import { queryClient } from '../../client';
import { documentLoadKeys } from './keys';

export type DocumentLoadBundle = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  token: string;
};

type LoadBundleResult = Result<
  DocumentLoadBundle,
  ResultError<keyof typeof LoadErrors>[]
>;

const STALE_TIME = 60 * 1000;
const GC_TIME = 60 * 1000;

async function resolveDocumentLoadBundle(
  documentId: string
): Promise<DocumentLoadBundle> {
  const [maybeDocument, maybeToken] = await Promise.all([
    throwOnErr(() => storageServiceClient.getDocumentMetadata({ documentId })),
    throwOnErr(() =>
      storageServiceClient.permissionsTokens.createPermissionToken({
        document_id: documentId,
      })
    ),
  ]);

  return {
    documentMetadata: maybeDocument.documentMetadata,
    userAccessLevel: maybeDocument.userAccessLevel,
    token: maybeToken.token,
  };
}

export function documentLoadQueryOptions(documentId: string) {
  return {
    queryKey: documentLoadKeys.bundle(documentId).queryKey,
    queryFn: () => resolveDocumentLoadBundle(documentId),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
    retry: false,
  };
}

export function fetchDocumentLoadBundle(
  documentId: string
): Promise<LoadBundleResult> {
  return loadResult(
    catchToResult(() =>
      queryClient.fetchQuery(documentLoadQueryOptions(documentId))
    )
  );
}

export function seedDocumentLoadBundle(
  documentId: string,
  bundle: DocumentLoadBundle,
  generation: string
) {
  if (!cacheSessionGeneration.isCurrent(generation)) return;
  queryClient.setQueryData(
    documentLoadKeys.bundle(documentId).queryKey,
    bundle
  );
}

/** A recovered identity load must reacquire its authorization credentials. */
export function invalidateDocumentLoadBundle(documentId: string) {
  return queryClient.invalidateQueries({
    queryKey: documentLoadKeys.bundle(documentId).queryKey,
    exact: true,
    refetchType: 'none',
  });
}
