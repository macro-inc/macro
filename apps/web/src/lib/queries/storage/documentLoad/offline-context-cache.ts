import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';
import { getDocumentVersionResponse } from '@service-storage/generated/zod';
import { z } from 'zod';
import type { ClearablePerQueryPersistence } from '../../persistence/per-query-idb';
import { documentLoadKeys } from './keys';

const BUSTER = 'sync-document-open-v1';
const contextSchema = z.object({
  syncService: z.literal(true),
  documentMetadata:
    getDocumentVersionResponse.shape.data.shape.documentMetadata.omit({
      documentBom: true,
      modificationData: true,
    }),
  userAccessLevel: getDocumentVersionResponse.shape.data.shape.userAccessLevel,
});

/** Non-secret, last-authorized context for a ready sync-service document. */
export type OfflineDocumentContext = {
  syncService: true;
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
};

export type DocumentCacheIdentity = Readonly<{ userId: string; epoch: string }>;
export type DocumentCacheSession = DocumentCacheIdentity &
  Readonly<{ generation: number }>;

/** User/session-fenced persistence. Tokens and opaque binary metadata are excluded. */
export function createOfflineDocumentContextCache(options: {
  store: ClearablePerQueryPersistence;
  identity: () => DocumentCacheIdentity | undefined;
}) {
  let generation = 0;
  const capture = (): DocumentCacheSession | undefined => {
    const identity = options.identity();
    return identity ? { ...identity, generation } : undefined;
  };
  const isCurrent = (session: DocumentCacheSession) => {
    const current = capture();
    return (
      current?.userId === session.userId &&
      current.epoch === session.epoch &&
      current.generation === session.generation
    );
  };
  const key = (session: DocumentCacheSession, documentId: string) =>
    documentLoadKeys.offlineContext(session.userId, session.epoch, documentId)
      .queryKey;

  return {
    capture,
    isCurrent,
    async read(
      session: DocumentCacheSession,
      documentId: string
    ): Promise<OfflineDocumentContext | undefined> {
      if (!isCurrent(session)) return;
      const queryKey = key(session, documentId);
      const hash = JSON.stringify(queryKey);
      try {
        const entry = await options.store.get(hash);
        if (
          !isCurrent(session) ||
          !entry ||
          entry.buster !== BUSTER ||
          entry.queryHash !== hash ||
          JSON.stringify(entry.queryKey) !== hash
        )
          return;
        const parsed = contextSchema.safeParse(entry.data);
        if (
          !parsed.success ||
          parsed.data.documentMetadata.documentId !== documentId ||
          parsed.data.documentMetadata.deletedAt != null
        )
          return;
        return parsed.data;
      } catch {
        // A storage failure must not prevent an online open.
        return;
      }
    },
    async write(
      session: DocumentCacheSession,
      context: OfflineDocumentContext
    ): Promise<void> {
      if (!isCurrent(session)) return;
      const data = contextSchema.parse(context);
      const queryKey = key(session, data.documentMetadata.documentId);
      if (data.documentMetadata.deletedAt != null) {
        options.store.remove(JSON.stringify(queryKey));
        await options.store.flush();
        return;
      }
      const now = Date.now();
      options.store.set({
        queryHash: JSON.stringify(queryKey),
        queryKey,
        data,
        dataUpdatedAt: now,
        persistedAt: now,
        buster: BUSTER,
      });
      await options.store.flush();
    },
    async remove(
      session: DocumentCacheSession,
      documentId: string
    ): Promise<void> {
      if (!isCurrent(session)) return;
      options.store.remove(JSON.stringify(key(session, documentId)));
      await options.store.flush();
    },
    clear(): Promise<void> {
      // Fence old reads/network responses before waiting for IndexedDB.
      generation += 1;
      return options.store.clear();
    },
  };
}

export type OfflineDocumentContextCache = ReturnType<
  typeof createOfflineDocumentContextCache
>;
