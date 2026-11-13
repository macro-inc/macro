import { contentHash, toHex } from '@core/util/hash';
import { getWebOrigin } from '@core/util/webOrigin';
import { v7 as uuidv7 } from 'uuid';
import { createBrowserChangeFeed } from './queries/change-feed';
import { createIndexedDbDocumentBlobs } from './queries/document-blobs';
import {
  createLocalContracts,
  LOCAL_CONTRACTS_STORAGE_KEY,
  type LocalContracts,
} from './queries/local-contracts';
import { openPdfDocument } from './queries/pdf-document';

const TOKEN_BYTES = 32;

/**
 * Contracts backed by this browser's own storage. The workspace and the
 * signing page each create one; a change feed keeps them in step, including
 * across tabs. Create it under a Solid owner.
 */
export function createBrowserContracts(): LocalContracts {
  return createLocalContracts({
    storage: window.localStorage,
    blobs: createIndexedDbDocumentBlobs('macro-contracts-documents'),
    changes: createBrowserChangeFeed(
      'macro-contracts',
      LOCAL_CONTRACTS_STORAGE_KEY
    ),
    openPdf: openPdfDocument,
    digestText: (text) => contentHash(new TextEncoder().encode(text)),
    digestBytes: contentHash,
    clock: () => new Date().toISOString(),
    newId: uuidv7,
    newToken: () => toHex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES))),
    signingUrl: (token) => `${getWebOrigin()}/app/sign/${token}`,
  });
}
