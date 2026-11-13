import type { PdfDocument } from '../context/contracts-context';
import type { DocumentBlobs } from '../queries/document-blobs';
import { createQueue } from '../queries/exclusive';
import {
  createLocalContracts,
  localContractsStorageKey,
} from '../queries/local-contracts';
import { sha256 } from './packets';

/** The account `fakeBrowser().open()` signs in as. */
const TEST_SCOPE = 'owner';
export const TEST_STORAGE_KEY = localContractsStorageKey(TEST_SCOPE);

/** A browser's storage shared by every store opened on it. */
export function fakeBrowser() {
  const items = new Map<string, string>();
  const documents = new Map<string, ArrayBuffer>();
  const listeners = new Set<() => void>();
  // One lock for the whole browser, as a Web Lock is.
  const exclusive = createQueue();
  let ids = 0;
  let now = '2026-11-09T21:02:11.000Z';
  let full = false;

  const storage: Storage = {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      if (full) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
    clear: () => items.clear(),
  };
  const blobs: DocumentBlobs = {
    put: async (documentId, bytes) => {
      documents.set(documentId, bytes);
    },
    get: async (documentId) => documents.get(documentId),
    delete: async (documentId) => {
      documents.delete(documentId);
    },
  };
  const pdf: PdfDocument = {
    pageCount: 3,
    pageAspectRatio: async () => 0.77,
    renderPage: async () => {},
    pageText: async () => 'Order Form',
  };

  return {
    items,
    storage,
    documents,
    setNow(next: string) {
      now = next;
    },
    /** Make the browser refuse writes, as it does when storage is full. */
    setFull(next: boolean) {
      full = next;
    },
    /** Open the store as one tab or view would. Call inside a root. */
    open(scope: string = TEST_SCOPE) {
      // A change reaches every other open store, never the one that made it.
      let own: (() => void) | undefined;
      return createLocalContracts({
        storage,
        storageKey: localContractsStorageKey(scope),
        blobs,
        exclusive,
        changes: {
          publish: () => {
            for (const listener of listeners) {
              if (listener !== own) listener();
            }
          },
          subscribe: (listener) => {
            own = listener;
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        openPdf: async () => pdf,
        digestText: sha256,
        digestBytes: async () => 'f'.repeat(64),
        clock: () => now,
        newId: () => `id-${++ids}`,
        newToken: () => `token-${++ids}`.padEnd(16, '0'),
        signingUrl: (token) => `https://app.example/sign/${token}`,
      });
    },
  };
}

export const VIEWER = () => ({
  id: 'owner',
  name: 'Avery Lee',
  email: 'avery.lee@macro.example',
});
