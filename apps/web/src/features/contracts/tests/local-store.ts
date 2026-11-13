import type { PdfDocument } from '../context/contracts-context';
import type { DocumentBlobs } from '../queries/document-blobs';
import {
  createLocalContracts,
  type LocalContractsDeps,
} from '../queries/local-contracts';
import { sha256 } from './packets';

/** A browser's storage shared by every store opened on it. */
export function fakeBrowser() {
  const items = new Map<string, string>();
  const documents = new Map<string, ArrayBuffer>();
  const listeners = new Set<() => void>();
  let ids = 0;
  let now = '2026-11-09T21:02:11.000Z';

  const storage: LocalContractsDeps['storage'] = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
  const blobs: DocumentBlobs = {
    put: async (documentId, bytes) => {
      documents.set(documentId, bytes);
    },
    get: async (documentId) => documents.get(documentId),
  };
  const pdf: PdfDocument = {
    pageCount: 3,
    pageAspectRatio: async () => 0.77,
    renderPage: async () => {},
  };

  return {
    items,
    setNow(next: string) {
      now = next;
    },
    /** Open the store as one tab or view would. Call inside a root. */
    open() {
      // A change reaches every other open store, never the one that made it.
      let own: (() => void) | undefined;
      return createLocalContracts({
        storage,
        blobs,
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
