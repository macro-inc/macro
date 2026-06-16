import { storageServiceClient } from '@service-storage/client';
import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { queryClient } from '../../client';
import { documentLoadKeys } from './keys';

export type DocumentLoadBundle = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  token: string;
};

const STALE_TIME = 60 * 1000;
const GC_TIME = 60 * 1000;

async function fetchDocumentLoadBundle(
  documentId: string
): Promise<DocumentLoadBundle> {
  const [maybeDocument, maybeToken] = await Promise.all([
    storageServiceClient.getDocumentMetadata({ documentId }),
    storageServiceClient.permissionsTokens.createPermissionToken({
      document_id: documentId,
    }),
  ]);

  if (maybeToken.isErr()) throw new Error('UNAUTHORIZED');
  if (maybeDocument.isErr())
    throw new Error('Failed to fetch document metadata');

  return {
    documentMetadata: maybeDocument.value.documentMetadata,
    userAccessLevel: maybeDocument.value.userAccessLevel,
    token: maybeToken.value.token,
  };
}

export function documentLoadQueryOptions(documentId: string) {
  return {
    queryKey: documentLoadKeys.bundle(documentId).queryKey,
    queryFn: () => fetchDocumentLoadBundle(documentId),
    staleTime: STALE_TIME,
    gcTime: GC_TIME,
  };
}

export function seedDocumentLoadBundle(
  documentId: string,
  bundle: DocumentLoadBundle
) {
  queryClient.setQueryData(
    documentLoadKeys.bundle(documentId).queryKey,
    bundle
  );
}
