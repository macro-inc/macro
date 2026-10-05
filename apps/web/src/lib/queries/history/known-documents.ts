import type { CacheHost } from '@graphql-cache/index';
import { KnownDocumentsDocument } from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';

const DOCUMENT_LOOKUP_BATCH_SIZE = 100;

/** History and successful opens supply IDs, never permission grants or metadata.
 * Only fresh authorized responses populate the viewer's Quick Access projection.
 * Explicit omissions evict stale records; request failures never imply revocation.
 */
export async function hydrateKnownGraphqlDocuments(
  client: Client,
  cacheHost: Pick<CacheHost, 'deleteRecords'>,
  documentIds: string[]
): Promise<void> {
  const ids = [...new Set(documentIds)];
  for (
    let offset = 0;
    offset < ids.length;
    offset += DOCUMENT_LOOKUP_BATCH_SIZE
  ) {
    const batch = ids.slice(offset, offset + DOCUMENT_LOOKUP_BATCH_SIZE);
    const result = await client
      .query(
        KnownDocumentsDocument,
        { documentIds: batch },
        { requestPolicy: 'network-only' }
      )
      .toPromise();
    if (result.error) throw result.error;
    if (!result.data?.user)
      throw new Error('KnownDocuments returned no viewer');
    const authorized = new Set(
      result.data.user.documents.map((document) => document.id)
    );
    const unavailable = batch.filter((id) => !authorized.has(id));
    if (unavailable.length) {
      await cacheHost.deleteRecords(
        unavailable.map((id) => `GraphqlSoupDocument:${id}`)
      );
    }
  }
}
