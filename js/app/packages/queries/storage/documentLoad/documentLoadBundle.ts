import { LoadErrors, loadResult } from '@core/block';
import type { ResultError } from '@core/util/result';
import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { err, ok, type Result } from 'neverthrow';
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
): Promise<LoadBundleResult> {
  const [maybeDocument, maybeToken] = await Promise.all([
    loadResult(storageServiceClient.getDocumentMetadata({ documentId })),
    storageServiceClient.permissionsTokens.createPermissionToken({
      document_id: documentId,
    }),
  ]);

  if (maybeToken.isErr()) return LoadErrors.UNAUTHORIZED;
  if (maybeDocument.isErr()) return err(maybeDocument.error);

  return ok({
    documentMetadata: maybeDocument.value.documentMetadata,
    userAccessLevel: maybeDocument.value.userAccessLevel,
    token: maybeToken.value.token,
  });
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
  return queryClient.fetchQuery(documentLoadQueryOptions(documentId));
}

export function seedDocumentLoadBundle(
  documentId: string,
  bundle: DocumentLoadBundle
) {
  queryClient.setQueryData(
    documentLoadKeys.bundle(documentId).queryKey,
    ok(bundle)
  );
}
