import type { AccessLevel } from '@service-storage/generated/schemas/accessLevel';
import type { DocumentMetadata } from '@service-storage/generated/schemas/documentMetadata';

export type MdCreateCacheEntry = {
  documentMetadata: DocumentMetadata;
  userAccessLevel: AccessLevel;
  token: string;
};

const cache = new Map<string, MdCreateCacheEntry>();

export function cacheMdCreate(documentId: string, entry: MdCreateCacheEntry) {
  cache.set(documentId, entry);
}

export function consumeMdCreate(documentId: string): MdCreateCacheEntry | undefined {
  const entry = cache.get(documentId);
  cache.delete(documentId);
  return entry;
}
