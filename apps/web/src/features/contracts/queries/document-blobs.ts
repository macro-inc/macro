import { RecoverableIDB } from '@app/lib/persistence/recoverable-idb';

const STORE = 'documents';

/** PDF bytes by document id. */
export type DocumentBlobs = {
  put(documentId: string, bytes: ArrayBuffer): Promise<void>;
  get(documentId: string): Promise<ArrayBuffer | undefined>;
  delete(documentId: string): Promise<void>;
};

/** Document bytes kept in this browser's IndexedDB. */
export function createIndexedDbDocumentBlobs(name: string): DocumentBlobs {
  const database = new RecoverableIDB(name, 1, (db) => {
    db.createObjectStore(STORE);
  });

  return {
    put: (documentId, bytes) =>
      database.run<void>(STORE, 'readwrite', (tx, finish) => {
        const request = tx.objectStore(STORE).put(bytes, documentId);
        request.onsuccess = () => finish(undefined);
      }),
    get: (documentId) =>
      database.run<ArrayBuffer | undefined>(STORE, 'readonly', (tx, finish) => {
        const request = tx.objectStore(STORE).get(documentId);
        request.onsuccess = () => finish(request.result ?? undefined);
      }),
    delete: (documentId) =>
      database.run<void>(STORE, 'readwrite', (tx, finish) => {
        const request = tx.objectStore(STORE).delete(documentId);
        request.onsuccess = () => finish(undefined);
      }),
  };
}
